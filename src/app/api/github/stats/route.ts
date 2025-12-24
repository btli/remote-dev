/**
 * GET /api/github/stats - Get enriched repository list with stats
 * POST /api/github/stats - Refresh all repository stats
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubStatsService from "@/services/github-stats-service";
import * as CacheService from "@/services/cache-service";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const repositories = await GitHubStatsService.getEnrichedRepositories(
      session.user.id
    );

    // Get total unseen changes
    const changes = await CacheService.getUnseenChanges(session.user.id);

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
    return NextResponse.json(
      { error: err.message, code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const result = await GitHubStatsService.refreshAllStats(session.user.id);

    // Get updated repositories after refresh
    const repositories = await GitHubStatsService.getEnrichedRepositories(
      session.user.id
    );

    // Get total unseen changes
    const changes = await CacheService.getUnseenChanges(session.user.id);

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
    return NextResponse.json(
      { error: err.message, code: "REFRESH_ERROR" },
      { status: 500 }
    );
  }
}
