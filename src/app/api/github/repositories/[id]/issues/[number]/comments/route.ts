import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/github");

/**
 * GET /api/github/repositories/:id/issues/:number/comments
 *
 * Fetch comments for a specific issue directly from GitHub API (not cached).
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const repoId = params?.id;
    const issueNumber = params?.number ? parseInt(params.number, 10) : NaN;

    if (!repoId) {
      return errorResponse("Repository ID is required", 400, "ID_REQUIRED");
    }
    if (isNaN(issueNumber) || issueNumber <= 0) {
      return errorResponse("Valid issue number is required", 400, "INVALID_ISSUE_NUMBER");
    }

    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse(
        "GitHub not connected. Link your GitHub account first.",
        400,
        "GITHUB_NOT_CONNECTED"
      );
    }

    const repo = await GitHubService.getRepository(repoId, userId);
    if (!repo) {
      return errorResponse("Repository not found", 404, "REPO_NOT_FOUND");
    }

    const [owner, repoName] = repo.fullName.split("/");
    if (!owner || !repoName) {
      return errorResponse("Invalid repository name format", 400, "INVALID_REPO_NAME");
    }

    const comments = await GitHubService.listIssueCommentsFromAPI(
      accessToken,
      owner,
      repoName,
      issueNumber
    );

    return NextResponse.json({ comments });
  } catch (error) {
    log.error("Failed to fetch issue comments", { error: String(error) });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch comments",
      500,
      "FETCH_COMMENTS_FAILED"
    );
  }
});
