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

    return NextResponse.json({
      repositories,
      changes: {
        totalPRs: changes.totalPRs,
        totalIssues: changes.totalIssues,
        hasChanges: changes.totalPRs > 0 || changes.totalIssues > 0,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching GitHub stats:", error);
    const err = error as Error;
    return errorResponse(err.message, 500, "FETCH_ERROR");
  }
});

export const POST = withAuth(async (_request, { userId }) => {
  try {
    const result = await GitHubStatsService.refreshAllStats(userId);

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
