import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as GitHubAccountService from "@/services/github-account-service";

/**
 * GET /api/github/account
 * Returns GitHub account info and statistics
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const accessToken = await GitHubService.getAccessToken(userId);

    if (!accessToken) {
      return NextResponse.json({
        connected: false,
        account: null,
        stats: null,
      });
    }

    // Fetch account info and stats in parallel
    const [accountInfo, stats] = await Promise.all([
      GitHubAccountService.getAccountInfo(accessToken),
      GitHubAccountService.getAccountStats(userId),
    ]);

    return NextResponse.json({
      connected: true,
      account: accountInfo,
      stats: {
        totalRepos: stats.totalRepos,
        clonedRepos: stats.clonedRepos,
        totalDiskSize: stats.totalDiskSize,
        totalDiskSizeFormatted: GitHubAccountService.formatBytes(
          stats.totalDiskSize
        ),
        lastSync: stats.lastSync?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode || 500, error.code);
    }
    throw error;
  }
});

/**
 * POST /api/github/account
 * Force refresh all repositories from GitHub API
 */
export const POST = withAuth(async (_request, { userId }) => {
  try {
    const accessToken = await GitHubService.getAccessToken(userId);

    if (!accessToken) {
      return errorResponse(
        "GitHub not connected",
        400,
        "GITHUB_NOT_CONNECTED"
      );
    }

    // Sync all repositories from GitHub API
    const repositories =
      await GitHubAccountService.syncAllRepositories(userId, accessToken);

    // Get updated stats
    const stats = await GitHubAccountService.getAccountStats(userId);

    return NextResponse.json({
      success: true,
      repositories,
      stats: {
        totalRepos: stats.totalRepos,
        clonedRepos: stats.clonedRepos,
        totalDiskSize: stats.totalDiskSize,
        totalDiskSizeFormatted: GitHubAccountService.formatBytes(
          stats.totalDiskSize
        ),
        lastSync: stats.lastSync?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode || 500, error.code);
    }
    throw error;
  }
});

/**
 * DELETE /api/github/account
 * Disconnect GitHub account
 * Query params:
 * - clearCache: boolean - Whether to also clear cached repositories (default: false)
 */
export const DELETE = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const clearCache = searchParams.get("clearCache") === "true";

  try {
    await GitHubAccountService.disconnectGitHub(userId, clearCache);

    return NextResponse.json({
      success: true,
      message: "GitHub disconnected successfully",
    });
  } catch (error) {
    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode || 500, error.code);
    }
    throw error;
  }
});
