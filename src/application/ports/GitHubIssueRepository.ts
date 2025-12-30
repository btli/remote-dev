/**
 * GitHubIssueRepository - Port interface for GitHub issue persistence.
 *
 * This interface defines the contract for GitHub issue data access.
 * Implementations can use any persistence mechanism (Drizzle, in-memory, etc.)
 *
 * Repository methods return domain entities (GitHubIssue), not database records.
 * The implementation is responsible for mapping between DB and domain types.
 */

import type { GitHubIssue, IssueState } from "@/domain/entities/GitHubIssue";

export interface IssueFilters {
  /** Filter by issue state */
  state?: IssueState;
  /** Filter by "new" flag */
  isNew?: boolean;
  /** Filter by having a milestone */
  hasMilestone?: boolean;
}

export interface IssueOrderBy {
  field: "number" | "createdAt" | "updatedAt" | "comments";
  direction: "asc" | "desc";
}

export interface GitHubIssueRepository {
  /**
   * Find all issues for a repository.
   */
  findByRepositoryId(
    repositoryId: string,
    options?: {
      filters?: IssueFilters;
      orderBy?: IssueOrderBy;
      limit?: number;
      offset?: number;
    }
  ): Promise<GitHubIssue[]>;

  /**
   * Find a specific issue by repository ID and issue number.
   */
  findByNumber(
    repositoryId: string,
    issueNumber: number
  ): Promise<GitHubIssue | null>;

  /**
   * Find an issue by its database ID.
   */
  findById(id: string): Promise<GitHubIssue | null>;

  /**
   * Count issues for a repository (with optional filters).
   */
  count(repositoryId: string, filters?: IssueFilters): Promise<number>;

  /**
   * Count new (unseen) issues for a repository.
   */
  countNew(repositoryId: string): Promise<number>;

  /**
   * Save an issue (insert or update).
   * Returns the saved issue.
   */
  save(issue: GitHubIssue): Promise<GitHubIssue>;

  /**
   * Save multiple issues in a batch.
   * More efficient than individual saves.
   */
  saveMany(issues: GitHubIssue[]): Promise<void>;

  /**
   * Delete all issues for a repository.
   * Used when refreshing the entire issue list.
   */
  deleteByRepositoryId(repositoryId: string): Promise<number>;

  /**
   * Delete stale issues (cached before a certain date).
   */
  deleteStale(repositoryId: string, cachedBefore: Date): Promise<number>;

  /**
   * Mark all issues in a repository as seen.
   */
  markAllAsSeen(repositoryId: string): Promise<number>;

  /**
   * Mark a specific issue as seen.
   */
  markAsSeen(repositoryId: string, issueNumber: number): Promise<boolean>;

  /**
   * Check if any issues exist for a repository.
   */
  exists(repositoryId: string): Promise<boolean>;

  /**
   * Get the cache age for a repository's issues.
   * Returns null if no cached issues exist.
   */
  getCacheAge(repositoryId: string): Promise<Date | null>;

  /**
   * Check if the cache is expired for a repository.
   * @param ttlMs Time-to-live in milliseconds
   */
  isCacheExpired(repositoryId: string, ttlMs: number): Promise<boolean>;
}
