/**
 * GET /api/github/stats - Get enriched repository list with stats
 * POST /api/github/stats - Refresh all repository stats
 */

import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubStatsService from "@/services/github-stats-service";
import * as CacheService from "@/services/cache-service";

export const GET = withAuth(async (_request, { userId }) => {
  try {
    const repositories = await GitHubStatsService.getEnrichedRepositories(
      userId
    );

    // Get total unseen changes
    const changes = await CacheService.getUnseenChanges(userId);

    // Check for stale/missing stats that need refresh
    const repoIds = repositories.map((r) => r.id);
    const staleRepoIds = await CacheService.getStaleRepositoryIds(userId, repoIds);
    const hasStaleData = staleRepoIds.length > 0;

    console.log(`[GitHubStats] GET: ${repositories.length} repos, ${staleRepoIds.length} stale, hasStaleData=${hasStaleData}`);

    return NextResponse.json({
      repositories,
      changes: {
        totalPRs: changes.totalPRs,
        totalIssues: changes.totalIssues,
        hasChanges: changes.totalPRs > 0 || changes.totalIssues > 0,
      },
      hasStaleData,
      staleCount: staleRepoIds.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching GitHub stats:", error);
    const err = error as Error;
    return errorResponse(err.message, 500, "FETCH_ERROR");
  }
});

export const POST = withAuth(async (_request, { userId }) => {
  console.log("[GitHubStats] POST: Starting refresh...");
  try {
    const result = await GitHubStatsService.refreshAllStats(userId);
    console.log(`[GitHubStats] POST: Refresh complete - ${result.updatedRepos.length} updated, ${result.errors.length} errors`);

    // Get updated repositories after refresh
    const repositories = await GitHubStatsService.getEnrichedRepositories(
      userId
    );

    // Get total unseen changes
    const changes = await CacheService.getUnseenChanges(userId);

    return NextResponse.json({
      repositories,
      result,
      changes: {
        totalPRs: changes.totalPRs,
        totalIssues: changes.totalIssues,
        hasChanges: changes.totalPRs > 0 || changes.totalIssues > 0,
      },
    });
  } catch (error) {
    console.error("Error refreshing GitHub stats:", error);
    const err = error as Error;
    return errorResponse(err.message, 500, "REFRESH_ERROR");
  }
});
