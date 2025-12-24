/**
 * GET /api/github/stats/:repoId - Get stats for a specific repository
 * POST /api/github/stats/:repoId - Refresh stats for a specific repository
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubStatsService from "@/services/github-stats-service";

interface RouteParams {
  params: Promise<{ repoId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const { repoId } = await params;

    const repositories = await GitHubStatsService.getEnrichedRepositories(
      session.user.id
    );

    const repository = repositories.find((r) => r.id === repoId);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ repository });
  } catch (error) {
    console.error("Error fetching repository stats:", error);
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const { repoId } = await params;

    await GitHubStatsService.refreshRepositoryStats(session.user.id, repoId);

    // Get updated repository
    const repositories = await GitHubStatsService.getEnrichedRepositories(
      session.user.id
    );

    const repository = repositories.find((r) => r.id === repoId);

    return NextResponse.json({
      repository,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error refreshing repository stats:", error);
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, code: "REFRESH_ERROR" },
      { status: 500 }
    );
  }
}
