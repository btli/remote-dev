import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees - Create a git worktree for a branch
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      repositoryId: string;
      branch: string;
      createNewBranch?: boolean;
      baseBranch?: string;
    }>(request);
    if ("error" in result) return result.error;
    const { repositoryId, branch, createNewBranch, baseBranch } = result.data;

    if (!repositoryId || !branch) {
      return errorResponse("repositoryId and branch are required", 400);
    }

    const repository = await GitHubService.getRepository(repositoryId, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    if (!repository.localPath) {
      return errorResponse("Repository not cloned. Clone it first.", 400, "NOT_CLONED");
    }

    let worktreePath: string;

    if (createNewBranch) {
      // Create a new branch with a worktree
      const result = await WorktreeService.createBranchWithWorktree(
        repository.localPath,
        branch,
        baseBranch || repository.defaultBranch
      );
      worktreePath = result.worktreePath;
    } else {
      // Create worktree for existing branch
      worktreePath = await WorktreeService.createWorktree(
        repository.localPath,
        branch
      );
    }

    return NextResponse.json({
      success: true,
      worktreePath,
      branch,
    });
  } catch (error) {
    console.error("Error creating worktree:", error);

    if (error instanceof WorktreeService.WorktreeServiceError) {
      return errorResponse(error.message, 400, error.code, error.details);
    }

    return errorResponse("Failed to create worktree", 500);
  }
});

/**
 * DELETE /api/github/worktrees - Remove a git worktree
 */
export const DELETE = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      repositoryId: string;
      worktreePath: string;
      force?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const { repositoryId, worktreePath, force } = result.data;

    if (!repositoryId || !worktreePath) {
      return errorResponse("repositoryId and worktreePath are required", 400);
    }

    const repository = await GitHubService.getRepository(repositoryId, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    if (!repository.localPath) {
      return errorResponse("Repository not cloned", 400);
    }

    await WorktreeService.removeWorktree(
      repository.localPath,
      worktreePath,
      force
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing worktree:", error);

    if (error instanceof WorktreeService.WorktreeServiceError) {
      return errorResponse(error.message, 400, error.code, error.details);
    }

    return errorResponse("Failed to remove worktree", 500);
  }
});
