/**
 * FetchIssuesForRepositoryUseCase - Orchestrates fetching and caching GitHub issues.
 *
 * This use case handles:
 * 1. Checking cache validity
 * 2. Fetching from GitHub API when stale
 * 3. Detecting new/changed issues
 * 4. Persisting to database cache
 * 5. Returning enriched issues with "isNew" flags
 */

import { GitHubIssue } from "@/domain/entities/GitHubIssue";
import type { GitHubIssueRepository } from "@/application/ports/GitHubIssueRepository";
import type { GitHubIssueGateway } from "@/application/ports/GitHubIssueGateway";

/** Default cache TTL: 15 minutes (matches GitHub stats) */
export const ISSUE_CACHE_TTL_MS = 15 * 60 * 1000;

export interface FetchIssuesInput {
  /** User requesting the issues (for auth) */
  userId: string;
  /** Internal repository ID */
  repositoryId: string;
  /** Repository owner (GitHub username/org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub access token */
  accessToken: string;
  /** Force refresh even if cache is valid */
  forceRefresh?: boolean;
  /** Issue state filter (default: "open") */
  state?: "open" | "closed" | "all";
}

export interface FetchIssuesOutput {
  /** Fetched issues */
  issues: GitHubIssue[];
  /** Whether any new issues were found */
  hasNewIssues: boolean;
  /** Count of new issues */
  newIssueCount: number;
  /** Whether data came from cache */
  fromCache: boolean;
  /** When the cache was last updated */
  cachedAt: Date | null;
}

export class FetchIssuesForRepositoryUseCase {
  constructor(
    private readonly issueRepository: GitHubIssueRepository,
    private readonly issueGateway: GitHubIssueGateway
  ) {}

  async execute(input: FetchIssuesInput): Promise<FetchIssuesOutput> {
    const { repositoryId, forceRefresh = false } = input;

    // Check if cache is valid
    if (!forceRefresh) {
      const cacheExpired = await this.issueRepository.isCacheExpired(
        repositoryId,
        ISSUE_CACHE_TTL_MS
      );

      if (!cacheExpired) {
        // Return cached issues
        // Note: "all" state means no filter, only "open"/"closed" are valid filters
        const stateFilter =
          input.state && input.state !== "all" ? { state: input.state } : undefined;
        const cachedIssues = await this.issueRepository.findByRepositoryId(
          repositoryId,
          {
            filters: stateFilter,
            orderBy: { field: "updatedAt", direction: "desc" },
          }
        );

        const newIssueCount = cachedIssues.filter((i) => i.isNew).length;
        const cachedAt = await this.issueRepository.getCacheAge(repositoryId);

        return {
          issues: cachedIssues,
          hasNewIssues: newIssueCount > 0,
          newIssueCount,
          fromCache: true,
          cachedAt,
        };
      }
    }

    // Fetch existing issues to detect changes
    const existingIssues = await this.issueRepository.findByRepositoryId(
      repositoryId
    );
    const existingByNumber = new Map(
      existingIssues.map((issue) => [issue.number, issue])
    );

    // Fetch fresh issues from GitHub
    const freshIssues = await this.issueGateway.fetchIssues({
      repositoryId,
      owner: input.owner,
      repo: input.repo,
      accessToken: input.accessToken,
      state: input.state ?? "open",
      perPage: 100,
    });

    // Detect new and updated issues
    let newIssueCount = 0;
    const processedIssues: GitHubIssue[] = [];

    for (const freshIssue of freshIssues) {
      const existing = existingByNumber.get(freshIssue.number);

      if (!existing) {
        // Completely new issue
        const markedNew = freshIssue.markAsNew();
        processedIssues.push(markedNew);
        newIssueCount++;
      } else if (freshIssue.hasUpdatedSince(existing)) {
        // Updated issue - always mark as new so user sees the update
        const wasNew = existing.isNew;
        const markedNew = freshIssue.markAsNew();
        processedIssues.push(markedNew);
        if (!wasNew) newIssueCount++;
      } else {
        // Unchanged - preserve isNew status
        const preserved = existing.isNew
          ? freshIssue.markAsNew()
          : freshIssue.markAsSeen();
        processedIssues.push(preserved);
        if (existing.isNew) newIssueCount++;
      }
    }

    // Persist the updated issues
    await this.issueRepository.saveMany(processedIssues);

    // Remove issues that are no longer in the fresh list
    const freshNumbers = new Set(freshIssues.map((i) => i.number));
    const staleIssues = existingIssues.filter(
      (i) => !freshNumbers.has(i.number)
    );
    if (staleIssues.length > 0) {
      // For now, just let them expire naturally
      // Could add explicit deletion if needed
    }

    // Apply state filter for the return value
    let filteredIssues = processedIssues;
    if (input.state && input.state !== "all") {
      filteredIssues = processedIssues.filter((i) =>
        input.state === "open" ? i.isOpen() : i.isClosed()
      );
    }

    return {
      issues: filteredIssues,
      hasNewIssues: newIssueCount > 0,
      newIssueCount,
      fromCache: false,
      cachedAt: new Date(),
    };
  }
}

export class FetchIssuesError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "FetchIssuesError";
  }
}
