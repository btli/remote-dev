/**
 * POST /api/github/pr-worktree - Create a worktree and session for a PR
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubStatsService from "@/services/github-stats-service";
import type { PRWorktreeRequest, PRWorktreeResponse } from "@/types/github-stats";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    let body: PRWorktreeRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_REQUEST" },
        { status: 400 }
      );
    }

    // Validate request
    if (!body.repositoryId || typeof body.prNumber !== "number") {
      return NextResponse.json(
        {
          error: "Missing required fields: repositoryId and prNumber",
          code: "INVALID_REQUEST",
        },
        { status: 400 }
      );
    }

    const result = await GitHubStatsService.createPRWorktree(
      session.user.id,
      body.repositoryId,
      body.prNumber,
      body.sessionName,
      body.folderId
    );

    const response: PRWorktreeResponse = {
      success: true,
      sessionId: result.sessionId,
      worktreePath: result.worktreePath,
      branch: result.branch,
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

    const status =
      err.code === "GITHUB_NOT_CONNECTED"
        ? 401
        : err.code === "REPO_NOT_FOUND" || err.code === "PR_NOT_FOUND"
        ? 404
        : 500;

    return NextResponse.json(response, { status });
  }
}
