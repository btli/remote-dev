import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * GET /api/github/repositories/:id/issues - List issues for a repository
 *
 * This endpoint is designed for the Agent API orchestrator workflow.
 * An orchestrator can list issues, then create worktree sessions to address each one.
 *
 * Query Parameters:
 * - state: "open" | "closed" | "all" (default: "open")
 * - per_page: Number of issues (default: 100, max: 100)
 * - page: Page number (default: 1)
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

    const perPageRaw = parseInt(searchParams.get("per_page") ?? "100", 10);
    const perPage = Number.isNaN(perPageRaw)
      ? 100
      : Math.min(Math.max(1, perPageRaw), 100);

    const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
    const page = Number.isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;

    // Split fullName into owner/repo
    const [owner, repoName] = repo.fullName.split("/");

    // Fetch issues
    const issues = await GitHubService.listIssuesFromAPI(
      accessToken,
      owner,
      repoName,
      state,
      perPage,
      page
    );

    return NextResponse.json({
      repository: {
        id: repo.id,
        fullName: repo.fullName,
      },
      issues,
      pagination: {
        page,
        perPage,
        count: issues.length,
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
