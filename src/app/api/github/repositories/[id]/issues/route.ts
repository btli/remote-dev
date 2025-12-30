import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import { fetchIssuesForRepositoryUseCase } from "@/infrastructure/container";
import { GitHubIssueMapper } from "@/infrastructure/persistence/mappers/GitHubIssueMapper";

/**
 * GET /api/github/repositories/:id/issues - List issues for a repository
 *
 * This endpoint supports both direct API access (for Agent workflows) and
 * cached access (for UI with background sync).
 *
 * Query Parameters:
 * - state: "open" | "closed" | "all" (default: "open")
 * - per_page: Number of issues (default: 100, max: 100)
 * - page: Page number (default: 1)
 * - refresh: "true" to force refresh cache
 *
 * Authentication: Supports both session auth and API key auth (Bearer token).
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const repoId = params?.id;
    if (!repoId) {
      return errorResponse("Repository ID is required", 400, "ID_REQUIRED");
    }

    // Get access token
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse(
        "GitHub not connected. Link your GitHub account first.",
        400,
        "GITHUB_NOT_CONNECTED"
      );
    }

    // Get repository
    const repo = await GitHubService.getRepository(repoId, userId);
    if (!repo) {
      return errorResponse("Repository not found", 404, "REPO_NOT_FOUND");
    }

    // Parse query parameters with validation
    const { searchParams } = new URL(request.url);
    const state = (searchParams.get("state") as "open" | "closed" | "all") ?? "open";
    const forceRefresh = searchParams.get("refresh") === "true";

    const perPageRaw = parseInt(searchParams.get("per_page") ?? "100", 10);
    const perPage = Number.isNaN(perPageRaw)
      ? 100
      : Math.min(Math.max(1, perPageRaw), 100);

    const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
    const page = Number.isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;

    // Split fullName into owner/repo
    const [owner, repoName] = repo.fullName.split("/");

    // Use the use case with caching
    const result = await fetchIssuesForRepositoryUseCase.execute({
      userId,
      repositoryId: repoId,
      owner,
      repo: repoName,
      accessToken,
      forceRefresh,
      state,
    });

    // Apply pagination to the results
    const startIndex = (page - 1) * perPage;
    const paginatedIssues = result.issues.slice(startIndex, startIndex + perPage);

    return NextResponse.json({
      repository: {
        id: repo.id,
        fullName: repo.fullName,
      },
      issues: GitHubIssueMapper.toApiResponseMany(paginatedIssues),
      pagination: {
        page,
        perPage,
        count: paginatedIssues.length,
        total: result.issues.length,
      },
      meta: {
        fromCache: result.fromCache,
        cachedAt: result.cachedAt?.toISOString() ?? null,
        hasNewIssues: result.hasNewIssues,
        newIssueCount: result.newIssueCount,
      },
    });
  } catch (error) {
    console.error("Error listing issues:", error);

    if (error instanceof GitHubService.GitHubServiceError) {
      return errorResponse(error.message, error.statusCode ?? 400, error.code);
    }

    return errorResponse("Failed to list issues", 500);
  }
});
