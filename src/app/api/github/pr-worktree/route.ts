/**
 * POST /api/github/pr-worktree - Create a worktree and session for a PR
 */

import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as GitHubStatsService from "@/services/github-stats-service";
import type { PRWorktreeRequest, PRWorktreeResponse } from "@/types/github-stats";

/**
 * Map error code to HTTP status
 */
function getStatusFromErrorCode(code: string | undefined): number {
  switch (code) {
    case "GITHUB_NOT_CONNECTED":
      return 401;
    case "REPO_NOT_FOUND":
    case "PR_NOT_FOUND":
      return 404;
    default:
      return 500;
  }
}

export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<PRWorktreeRequest>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  // Validate request
  if (!body.repositoryId || typeof body.prNumber !== "number") {
    return errorResponse(
      "Missing required fields: repositoryId and prNumber",
      400,
      "INVALID_REQUEST"
    );
  }

  try {
    const worktreeResult = await GitHubStatsService.createPRWorktree(
      userId,
      body.repositoryId,
      body.prNumber,
      body.sessionName,
      body.folderId
    );

    const response: PRWorktreeResponse = {
      success: true,
      sessionId: worktreeResult.sessionId,
      worktreePath: worktreeResult.worktreePath,
      branch: worktreeResult.branch,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error creating PR worktree:", error);
    const err = error as Error & { code?: string };

    const response: PRWorktreeResponse = {
      success: false,
      sessionId: "",
      worktreePath: "",
      branch: "",
      error: err.message,
    };

    return NextResponse.json(response, { status: getStatusFromErrorCode(err.code) });
  }
});
