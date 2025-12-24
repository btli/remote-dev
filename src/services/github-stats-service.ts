/**
 * GitHubStatsService - High-level service for managing GitHub repository stats
 * Orchestrates GraphQL fetching, caching, and change tracking
 */

import { db } from "@/db";
import {
  githubRepositories,
  githubRepositoryStats,
  githubPullRequests,
  githubBranchProtection,
  folderRepositories,
  githubChangeNotifications,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import * as GitHubService from "./github-service";
import * as GraphQLService from "./github-graphql-service";
import * as CacheService from "./cache-service";
import {
  GITHUB_STATS_TTL_MINUTES,
  type EnrichedRepository,
  type RepositoryStats,
  type PullRequest,
  type RefreshResult,
  type CommitInfo,
  type BranchProtection,
} from "@/types/github-stats";

export class GitHubStatsServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "GitHubStatsServiceError";
  }
}

// =============================================================================
// Repository Stats Operations
// =============================================================================

/**
 * Get enriched repositories for a user with stats
 */
export async function getEnrichedRepositories(
  userId: string
): Promise<EnrichedRepository[]> {
  // Get all user's repositories
  const repos = await db.query.githubRepositories.findMany({
    where: eq(githubRepositories.userId, userId),
  });

  // Get cached stats for all repos
  const repoIds = repos.map((r) => r.id);
  const stats = repoIds.length > 0
    ? await db.query.githubRepositoryStats.findMany({
        where: inArray(githubRepositoryStats.repositoryId, repoIds),
      })
    : [];

  // Get change notifications
  const notifications = repoIds.length > 0
    ? await db.query.githubChangeNotifications.findMany({
        where: and(
          eq(githubChangeNotifications.userId, userId),
          inArray(githubChangeNotifications.repositoryId, repoIds)
        ),
      })
    : [];

  // Get PRs for all repos
  const prs = repoIds.length > 0
    ? await db.query.githubPullRequests.findMany({
        where: and(
          inArray(githubPullRequests.repositoryId, repoIds),
          eq(githubPullRequests.state, "open")
        ),
      })
    : [];

  // Build enriched repositories
  const statsMap = new Map(stats.map((s) => [s.repositoryId, s]));
  const notificationMap = new Map(notifications.map((n) => [n.repositoryId, n]));
  const prsMap = new Map<string, typeof prs>();
  for (const pr of prs) {
    if (!prsMap.has(pr.repositoryId)) {
      prsMap.set(pr.repositoryId, []);
    }
    prsMap.get(pr.repositoryId)!.push(pr);
  }

  return repos.map((repo) => {
    const stat = statsMap.get(repo.id);
    const notification = notificationMap.get(repo.id);
    const repoPRs = prsMap.get(repo.id) ?? [];
    const [owner] = repo.fullName.split("/");

    // Parse JSON fields
    let ciStatusDetails = null;
    let recentCommits: CommitInfo[] = [];
    let branchProtection: BranchProtection | null = null;

    if (stat?.ciStatusDetails) {
      try {
        ciStatusDetails = JSON.parse(stat.ciStatusDetails);
      } catch (error) {
        console.error(`[GitHubStatsService] Failed to parse ciStatusDetails for repo ${repo.id}:`, error);
      }
    }

    if (stat?.recentCommits) {
      try {
        recentCommits = JSON.parse(stat.recentCommits);
      } catch (error) {
        console.error(`[GitHubStatsService] Failed to parse recentCommits for repo ${repo.id}:`, error);
      }
    }

    if (stat?.branchProtectionDetails) {
      try {
        branchProtection = JSON.parse(stat.branchProtectionDetails);
      } catch (error) {
        console.error(`[GitHubStatsService] Failed to parse branchProtectionDetails for repo ${repo.id}:`, error);
      }
    }

    const repositoryStats: RepositoryStats = {
      repositoryId: repo.id,
      openPRCount: stat?.openPRCount ?? 0,
      openIssueCount: stat?.openIssueCount ?? 0,
      ciStatus: ciStatusDetails,
      branchProtection,
      recentCommits,
      lastFetchedAt: stat?.cachedAt ? new Date(stat.cachedAt) : null,
    };

    // Map PRs to domain type
    const pullRequests: PullRequest[] = repoPRs.map((pr) => ({
      id: pr.id,
      number: pr.prNumber,
      title: pr.title,
      state: pr.state,
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      author: pr.author,
      authorAvatarUrl: pr.authorAvatarUrl ?? undefined,
      url: pr.url,
      ciStatus: pr.ciStatus
        ? {
            state: pr.ciStatus,
            checkRuns: [],
            totalCount: 0,
            successCount: 0,
            failureCount: 0,
            pendingCount: 0,
          }
        : null,
      isDraft: pr.isDraft,
      isNew: pr.isNew,
      additions: pr.additions,
      deletions: pr.deletions,
      reviewDecision: pr.reviewDecision ?? null,
      createdAt: new Date(pr.createdAt).toISOString(),
      updatedAt: new Date(pr.updatedAt).toISOString(),
    }));

    const changeCount = (notification?.newPRCount ?? 0) + (notification?.newIssueCount ?? 0);

    return {
      id: repo.id,
      name: repo.name,
      fullName: repo.fullName,
      owner,
      url: `https://github.com/${repo.fullName}`,
      description: null, // Not stored in current schema
      defaultBranch: repo.defaultBranch,
      localPath: repo.localPath,
      isPrivate: repo.isPrivate ?? false,
      isCloned: !!repo.localPath,
      stats: repositoryStats,
      pullRequests,
      hasChanges: changeCount > 0,
      changeCount,
    };
  });
}

/**
 * Refresh stats for all user's repositories
 */
export async function refreshAllStats(userId: string): Promise<RefreshResult> {
  const result: RefreshResult = {
    success: true,
    updatedRepos: [],
    newPRCount: 0,
    closedPRCount: 0,
    newIssueCount: 0,
    closedIssueCount: 0,
    errors: [],
    timestamp: new Date(),
  };

  try {
    // Get access token
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      throw new GitHubStatsServiceError(
        "GitHub not connected",
        "GITHUB_NOT_CONNECTED"
      );
    }

    // Get all user's repositories
    const repos = await db.query.githubRepositories.findMany({
      where: eq(githubRepositories.userId, userId),
    });

    if (repos.length === 0) {
      return result;
    }

    // Get existing PR numbers for change detection
    const existingPRsMap = new Map<string, Set<number>>();
    const allPRs = await db.query.githubPullRequests.findMany({
      where: inArray(
        githubPullRequests.repositoryId,
        repos.map((r) => r.id)
      ),
    });
    for (const pr of allPRs) {
      if (!existingPRsMap.has(pr.repositoryId)) {
        existingPRsMap.set(pr.repositoryId, new Set());
      }
      existingPRsMap.get(pr.repositoryId)!.add(pr.prNumber);
    }

    // Get previous stats for change detection
    const prevStats = await db.query.githubRepositoryStats.findMany({
      where: inArray(
        githubRepositoryStats.repositoryId,
        repos.map((r) => r.id)
      ),
    });
    const prevStatsMap = new Map(prevStats.map((s) => [s.repositoryId, s]));

    // Fetch stats using batched GraphQL
    const reposToFetch = repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      existingPRNumbers: existingPRsMap.get(r.id),
    }));

    const { results: fetchedStats, errors: fetchErrors } = await GraphQLService.fetchBatchedStats(
      accessToken,
      reposToFetch
    );

    // Track any batch errors
    for (const [repoId, error] of fetchErrors) {
      result.errors.push(`Repository ${repoId}: ${error.message}`);
    }

    // Update database with fetched stats
    for (const [repoId, data] of fetchedStats) {
      const prevStat = prevStatsMap.get(repoId);
      const repo = repos.find((r) => r.id === repoId);

      if (!repo) continue;

      // Calculate changes
      const prevPRCount = prevStat?.openPRCount ?? 0;
      const prevIssueCount = prevStat?.openIssueCount ?? 0;
      const newPRDelta = Math.max(0, data.stats.openPRCount - prevPRCount);
      const newIssueDelta = Math.max(0, data.stats.openIssueCount - prevIssueCount);

      result.newPRCount += newPRDelta;
      result.newIssueCount += newIssueDelta;
      result.closedPRCount += Math.max(0, prevPRCount - data.stats.openPRCount);
      result.closedIssueCount += Math.max(0, prevIssueCount - data.stats.openIssueCount);

      // Upsert repository stats
      const expiresAt = new Date(Date.now() + GITHUB_STATS_TTL_MINUTES * 60 * 1000);

      const existingStats = await db.query.githubRepositoryStats.findFirst({
        where: eq(githubRepositoryStats.repositoryId, repoId),
      });

      const statsData = {
        repositoryId: repoId,
        openPRCount: data.stats.openPRCount,
        openIssueCount: data.stats.openIssueCount,
        ciStatus: data.stats.ciStatus?.state ?? null,
        ciStatusDetails: data.stats.ciStatus
          ? JSON.stringify(data.stats.ciStatus)
          : null,
        branchProtected: data.branchProtection?.isProtected ?? false,
        branchProtectionDetails: data.branchProtection
          ? JSON.stringify(data.branchProtection)
          : null,
        recentCommits: JSON.stringify(data.recentCommits),
        cachedAt: new Date(),
        expiresAt,
      };

      if (existingStats) {
        await db
          .update(githubRepositoryStats)
          .set(statsData)
          .where(eq(githubRepositoryStats.id, existingStats.id));
      } else {
        await db.insert(githubRepositoryStats).values(statsData);
      }

      // Update PRs
      await updatePullRequests(repoId, data.pullRequests);

      // Update branch protection
      if (data.branchProtection) {
        await updateBranchProtection(repoId, data.branchProtection);
      }

      // Track changes for notifications
      if (newPRDelta > 0 || newIssueDelta > 0) {
        await CacheService.trackChanges(userId, repoId, newPRDelta, newIssueDelta);
      }

      result.updatedRepos.push(repoId);
    }

    return result;
  } catch (error) {
    const err = error as Error;
    result.success = false;
    result.errors.push(err.message);
    return result;
  }
}

/**
 * Refresh stats for a single repository
 */
export async function refreshRepositoryStats(
  userId: string,
  repositoryId: string
): Promise<void> {
  const accessToken = await GitHubService.getAccessToken(userId);
  if (!accessToken) {
    throw new GitHubStatsServiceError(
      "GitHub not connected",
      "GITHUB_NOT_CONNECTED"
    );
  }

  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.id, repositoryId),
      eq(githubRepositories.userId, userId)
    ),
  });

  if (!repo) {
    throw new GitHubStatsServiceError(
      "Repository not found",
      "REPO_NOT_FOUND"
    );
  }

  // Get existing PR numbers
  const existingPRs = await db.query.githubPullRequests.findMany({
    where: eq(githubPullRequests.repositoryId, repositoryId),
  });
  const existingPRNumbers = new Set(existingPRs.map((pr) => pr.prNumber));

  // Fetch fresh stats
  const [owner, name] = repo.fullName.split("/");
  const data = await GraphQLService.fetchRepositoryStats(
    accessToken,
    owner,
    name,
    existingPRNumbers
  );

  // Update database
  const expiresAt = new Date(Date.now() + GITHUB_STATS_TTL_MINUTES * 60 * 1000);

  const existingStats = await db.query.githubRepositoryStats.findFirst({
    where: eq(githubRepositoryStats.repositoryId, repositoryId),
  });

  const statsData = {
    repositoryId,
    openPRCount: data.stats.openPRCount,
    openIssueCount: data.stats.openIssueCount,
    ciStatus: data.stats.ciStatus?.state ?? null,
    ciStatusDetails: data.stats.ciStatus
      ? JSON.stringify(data.stats.ciStatus)
      : null,
    branchProtected: data.branchProtection?.isProtected ?? false,
    branchProtectionDetails: data.branchProtection
      ? JSON.stringify(data.branchProtection)
      : null,
    recentCommits: JSON.stringify(data.recentCommits),
    cachedAt: new Date(),
    expiresAt,
  };

  if (existingStats) {
    await db
      .update(githubRepositoryStats)
      .set(statsData)
      .where(eq(githubRepositoryStats.id, existingStats.id));
  } else {
    await db.insert(githubRepositoryStats).values(statsData);
  }

  await updatePullRequests(repositoryId, data.pullRequests);

  if (data.branchProtection) {
    await updateBranchProtection(repositoryId, data.branchProtection);
  }
}

// =============================================================================
// Folder-Repository Link Operations
// =============================================================================

/**
 * Link a folder to a repository
 */
export async function linkFolderToRepository(
  userId: string,
  folderId: string,
  repositoryId: string
): Promise<void> {
  // Check if already linked
  const existing = await db.query.folderRepositories.findFirst({
    where: and(
      eq(folderRepositories.folderId, folderId),
      eq(folderRepositories.userId, userId)
    ),
  });

  if (existing) {
    // Update existing link
    await db
      .update(folderRepositories)
      .set({ repositoryId })
      .where(eq(folderRepositories.id, existing.id));
  } else {
    // Create new link
    await db.insert(folderRepositories).values({
      folderId,
      repositoryId,
      userId,
    });
  }
}

/**
 * Unlink a folder from its repository
 */
export async function unlinkFolderFromRepository(
  userId: string,
  folderId: string
): Promise<void> {
  await db
    .delete(folderRepositories)
    .where(
      and(
        eq(folderRepositories.folderId, folderId),
        eq(folderRepositories.userId, userId)
      )
    );
}

// =============================================================================
// PR Worktree Operations
// =============================================================================

/**
 * Create a worktree and session for a PR
 */
export async function createPRWorktree(
  userId: string,
  repositoryId: string,
  prNumber: number,
  sessionName?: string,
  folderId?: string
): Promise<{
  sessionId: string;
  worktreePath: string;
  branch: string;
  folderId?: string;
}> {
  const accessToken = await GitHubService.getAccessToken(userId);
  if (!accessToken) {
    throw new GitHubStatsServiceError(
      "GitHub not connected",
      "GITHUB_NOT_CONNECTED"
    );
  }

  // Get repository
  const repo = await db.query.githubRepositories.findFirst({
    where: and(
      eq(githubRepositories.id, repositoryId),
      eq(githubRepositories.userId, userId)
    ),
  });

  if (!repo) {
    throw new GitHubStatsServiceError(
      "Repository not found",
      "REPO_NOT_FOUND"
    );
  }

  // Fetch PR details
  const [owner, repoName] = repo.fullName.split("/");
  const prDetails = await GraphQLService.fetchPRDetails(
    accessToken,
    owner,
    repoName,
    prNumber
  );

  if (!prDetails) {
    throw new GitHubStatsServiceError(
      `PR #${prNumber} not found`,
      "PR_NOT_FOUND"
    );
  }

  // Import worktree service dynamically to avoid circular dependencies
  const { createWorktree } = await import("./worktree-service");

  // Clone if needed
  if (!repo.localPath) {
    const cloneResult = await GitHubService.cloneRepository(
      accessToken,
      repo.fullName
    );
    if (!cloneResult.success) {
      throw new GitHubStatsServiceError(
        `Failed to clone repository: ${cloneResult.error}`,
        "CLONE_FAILED"
      );
    }
    // Update local path
    await GitHubService.updateLocalPath(repo.id, cloneResult.localPath);
    repo.localPath = cloneResult.localPath;
  }

  // Create worktree for PR branch
  const worktreePath = await createWorktree(
    repo.localPath,
    prDetails.branch,
    undefined,
    false // Don't create new branch, checkout existing
  );

  // Import session service
  const { createSession } = await import("./session-service");

  // Create session (folderId is handled via folder context on the client side)
  const session = await createSession(userId, {
    name: sessionName ?? `PR #${prNumber}: ${prDetails.title.slice(0, 30)}`,
    projectPath: worktreePath,
    githubRepoId: repositoryId,
    worktreeBranch: prDetails.branch,
  });

  // Note: folderId assignment is handled by the client after session creation
  // The caller can move the session to a folder using the folder context

  return {
    sessionId: session.id,
    worktreePath,
    branch: prDetails.branch,
    folderId, // Return folderId so caller can handle folder assignment
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Update pull requests in database
 */
async function updatePullRequests(
  repositoryId: string,
  pullRequests: PullRequest[]
): Promise<void> {
  // Delete existing PRs for this repo
  await db
    .delete(githubPullRequests)
    .where(eq(githubPullRequests.repositoryId, repositoryId));

  // Insert new PRs
  if (pullRequests.length > 0) {
    await db.insert(githubPullRequests).values(
      pullRequests.map((pr) => ({
        repositoryId,
        prNumber: pr.number,
        title: pr.title,
        state: pr.state,
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        author: pr.author,
        authorAvatarUrl: pr.authorAvatarUrl ?? null,
        url: pr.url,
        isDraft: pr.isDraft,
        additions: pr.additions,
        deletions: pr.deletions,
        reviewDecision: pr.reviewDecision,
        ciStatus: pr.ciStatus?.state ?? null,
        isNew: pr.isNew,
        createdAt: new Date(pr.createdAt),
        updatedAt: new Date(pr.updatedAt),
      }))
    );
  }
}

/**
 * Update branch protection in database
 */
async function updateBranchProtection(
  repositoryId: string,
  protection: BranchProtection
): Promise<void> {
  const existing = await db.query.githubBranchProtection.findFirst({
    where: and(
      eq(githubBranchProtection.repositoryId, repositoryId),
      eq(githubBranchProtection.branch, protection.branch)
    ),
  });

  const data = {
    repositoryId,
    branch: protection.branch,
    isProtected: protection.isProtected,
    requiresReview: protection.requiresReview,
    requiredReviewers: protection.requiredReviewers,
    requiresStatusChecks: protection.requiresStatusChecks,
    requiredChecks: JSON.stringify(protection.requiredChecks),
    allowsForcePushes: protection.allowsForcePushes,
    allowsDeletions: protection.allowsDeletions,
    cachedAt: new Date(),
  };

  if (existing) {
    await db
      .update(githubBranchProtection)
      .set(data)
      .where(eq(githubBranchProtection.id, existing.id));
  } else {
    await db.insert(githubBranchProtection).values(data);
  }
}
