/**
 * CacheService - Manages TTL-based caching for GitHub stats
 * Provides stale-while-revalidate pattern with change tracking
 */

import { db } from "@/db";
import {
  githubRepositoryStats,
  githubChangeNotifications,
} from "@/db/schema";
import { eq, and, lt, sql, inArray } from "drizzle-orm";
import { GITHUB_STATS_TTL_MINUTES, type CacheMetadata } from "@/types/github-stats";

export class CacheServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "CacheServiceError";
  }
}

/**
 * Check if a repository's stats cache has expired
 */
export async function isStale(repositoryId: string): Promise<boolean> {
  const stats = await db.query.githubRepositoryStats.findFirst({
    where: eq(githubRepositoryStats.repositoryId, repositoryId),
  });

  if (!stats) {
    return true; // No cache = stale
  }

  return new Date(stats.expiresAt) < new Date();
}

/**
 * Get cache metadata for a repository
 */
export async function getCacheMetadata(
  repositoryId: string
): Promise<CacheMetadata | null> {
  const stats = await db.query.githubRepositoryStats.findFirst({
    where: eq(githubRepositoryStats.repositoryId, repositoryId),
  });

  if (!stats) {
    return null;
  }

  return {
    key: repositoryId,
    cachedAt: new Date(stats.cachedAt),
    expiresAt: new Date(stats.expiresAt),
    isStale: new Date(stats.expiresAt) < new Date(),
  };
}

/**
 * Get all stale repository IDs for a user (for batch refresh)
 */
export async function getStaleRepositoryIds(
  _userId: string,
  repositoryIds: string[]
): Promise<string[]> {
  if (repositoryIds.length === 0) {
    return [];
  }

  const now = new Date();

  // Batch query: get all stats for the given repository IDs in a single query
  const allStats = await db.query.githubRepositoryStats.findMany({
    where: inArray(githubRepositoryStats.repositoryId, repositoryIds),
  });

  // Build a map for O(1) lookup
  const statsMap = new Map(allStats.map((s) => [s.repositoryId, s]));

  // Find stale or missing entries
  const staleIds: string[] = [];
  for (const repoId of repositoryIds) {
    const stats = statsMap.get(repoId);
    if (!stats || new Date(stats.expiresAt) < now) {
      staleIds.push(repoId);
    }
  }

  return staleIds;
}

/**
 * Update cache expiry time for a repository
 */
export async function updateCacheExpiry(
  repositoryId: string,
  ttlMinutes: number = GITHUB_STATS_TTL_MINUTES
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  await db
    .update(githubRepositoryStats)
    .set({
      cachedAt: now,
      expiresAt,
    })
    .where(eq(githubRepositoryStats.repositoryId, repositoryId));
}

/**
 * Invalidate cache for a repository (force refresh on next access)
 */
export async function invalidateCache(repositoryId: string): Promise<void> {
  await db
    .update(githubRepositoryStats)
    .set({
      expiresAt: new Date(0), // Set to past date to mark as stale
    })
    .where(eq(githubRepositoryStats.repositoryId, repositoryId));
}

/**
 * Invalidate all caches for a user
 */
export async function invalidateUserCaches(userId: string): Promise<void> {
  // Get all user's repository IDs first
  const repos = await db.query.githubRepositories.findMany({
    where: eq(
      (await import("@/db/schema")).githubRepositories.userId,
      userId
    ),
  });

  for (const repo of repos) {
    await invalidateCache(repo.id);
  }
}

/**
 * Clean up expired caches older than threshold
 */
export async function cleanupExpiredCaches(
  olderThanHours: number = 24
): Promise<number> {
  const threshold = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000
  );

  const result = await db
    .delete(githubRepositoryStats)
    .where(lt(githubRepositoryStats.expiresAt, threshold));

  return result.rowsAffected;
}

// =============================================================================
// Change Notifications
// =============================================================================

/**
 * Track changes (new PRs/issues) for a repository
 */
export async function trackChanges(
  userId: string,
  repositoryId: string,
  newPRCount: number,
  newIssueCount: number
): Promise<void> {
  const existing = await db.query.githubChangeNotifications.findFirst({
    where: and(
      eq(githubChangeNotifications.userId, userId),
      eq(githubChangeNotifications.repositoryId, repositoryId)
    ),
  });

  if (existing) {
    // Accumulate changes using atomic SQL operations to prevent race conditions
    await db
      .update(githubChangeNotifications)
      .set({
        newPRCount: sql`${githubChangeNotifications.newPRCount} + ${newPRCount}`,
        newIssueCount: sql`${githubChangeNotifications.newIssueCount} + ${newIssueCount}`,
      })
      .where(eq(githubChangeNotifications.id, existing.id));
  } else if (newPRCount > 0 || newIssueCount > 0) {
    // Create new notification record
    await db.insert(githubChangeNotifications).values({
      userId,
      repositoryId,
      newPRCount,
      newIssueCount,
    });
  }
}

/**
 * Get total unseen changes for a user
 */
export async function getUnseenChanges(userId: string): Promise<{
  totalPRs: number;
  totalIssues: number;
  repositories: Array<{
    repositoryId: string;
    newPRCount: number;
    newIssueCount: number;
  }>;
}> {
  const notifications = await db.query.githubChangeNotifications.findMany({
    where: eq(githubChangeNotifications.userId, userId),
  });

  return {
    totalPRs: notifications.reduce((sum, n) => sum + n.newPRCount, 0),
    totalIssues: notifications.reduce((sum, n) => sum + n.newIssueCount, 0),
    repositories: notifications.map((n) => ({
      repositoryId: n.repositoryId,
      newPRCount: n.newPRCount,
      newIssueCount: n.newIssueCount,
    })),
  };
}

/**
 * Mark changes as seen for a repository
 */
export async function markChangesSeen(
  userId: string,
  repositoryId: string
): Promise<void> {
  await db
    .update(githubChangeNotifications)
    .set({
      newPRCount: 0,
      newIssueCount: 0,
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(githubChangeNotifications.userId, userId),
        eq(githubChangeNotifications.repositoryId, repositoryId)
      )
    );
}

/**
 * Mark all changes as seen for a user
 */
export async function markAllChangesSeen(userId: string): Promise<void> {
  await db
    .update(githubChangeNotifications)
    .set({
      newPRCount: 0,
      newIssueCount: 0,
      lastSeenAt: new Date(),
    })
    .where(eq(githubChangeNotifications.userId, userId));
}

/**
 * Check if user has any unseen changes
 */
export async function hasUnseenChanges(userId: string): Promise<boolean> {
  const notification = await db.query.githubChangeNotifications.findFirst({
    where: and(
      eq(githubChangeNotifications.userId, userId),
      // Check if either count is > 0
    ),
  });

  if (!notification) {
    return false;
  }

  return notification.newPRCount > 0 || notification.newIssueCount > 0;
}
