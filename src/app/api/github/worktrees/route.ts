import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees - Create a git worktree for a branch
 *
 * Accepts either:
 * - repositoryId: Looks up the repo from database (legacy)
 * - projectPath: Uses the path directly if it's a valid git repo (preferred)
 *
 * When projectPath is provided, worktrees are created relative to that path.
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { repositoryId, projectPath, branch, createNewBranch, baseBranch } = body;

  if (!branch) {
    return errorResponse("branch is required", 400);
  }

  if (!repositoryId && !projectPath) {
    return errorResponse("Either repositoryId or projectPath is required", 400);
  }

  let repoPath: string;
  let defaultBranch: string | undefined;

  // Prefer projectPath if provided (folder's git repo)
  if (projectPath) {
    // Validate it's a git repo
    if (!(await WorktreeService.isGitRepo(projectPath))) {
      return errorResponse("projectPath is not a git repository", 400, "NOT_GIT_REPO");
    }
    repoPath = projectPath;
    // Get the default branch from the repo itself
    const currentBranch = await WorktreeService.getCurrentBranch(projectPath);
    defaultBranch = currentBranch || "main";
  } else {
    // Fall back to repositoryId lookup
    const repository = await GitHubService.getRepository(repositoryId, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    if (!repository.localPath) {
      return errorResponse("Repository not cloned. Clone it first.", 400, "NOT_CLONED");
    }

    repoPath = repository.localPath;
    defaultBranch = repository.defaultBranch;
  }

  console.log("Creating worktree:", {
    repositoryId,
    projectPath,
    branch,
    createNewBranch,
    baseBranch,
    repoPath,
  });

  try {
    let worktreePath: string;

    if (createNewBranch) {
      // Create a new branch with a worktree
      const result = await WorktreeService.createBranchWithWorktree(
        repoPath,
        branch,
        baseBranch || defaultBranch
      );
      worktreePath = result.worktreePath;
    } else {
      // Create worktree for existing branch
      worktreePath = await WorktreeService.createWorktree(
        repoPath,
        branch
      );
    }

    return NextResponse.json({
      success: true,
      worktreePath,
      branch,
    });
  } catch (error) {
    if (error instanceof WorktreeService.WorktreeServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 400 }
      );
    }
    throw error;
  }
});

/**
 * DELETE /api/github/worktrees - Remove a git worktree
 *
 * Accepts either:
 * - repositoryId: Looks up the repo from database (legacy)
 * - projectPath: Uses the path directly to find the main repo (preferred)
 */
export const DELETE = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { repositoryId, projectPath, worktreePath, force } = body;

  if (!worktreePath) {
    return errorResponse("worktreePath is required", 400);
  }

  if (!repositoryId && !projectPath) {
    return errorResponse("Either repositoryId or projectPath is required", 400);
  }

  let repoPath: string;

  // Prefer projectPath if provided
  if (projectPath) {
    // Get the root of the git repo (handles both main repo and worktree paths)
    const repoRoot = await WorktreeService.getRepoRoot(projectPath);
    if (!repoRoot) {
      return errorResponse("projectPath is not a git repository", 400, "NOT_GIT_REPO");
    }
    repoPath = repoRoot;
  } else {
    const repository = await GitHubService.getRepository(repositoryId, userId);

    if (!repository) {
      return errorResponse("Repository not found", 404);
    }

    if (!repository.localPath) {
      return errorResponse("Repository not cloned", 400);
    }

    repoPath = repository.localPath;
  }

  try {
    const result = await WorktreeService.removeWorktree(
      repoPath,
      worktreePath,
      force
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorktreeService.WorktreeServiceError) {
      // Use 409 Conflict for safety-related blocks (uncommitted changes, unpushed commits)
      const status = error.code === "HAS_UNCOMMITTED_CHANGES" || error.code === "HAS_UNPUSHED_COMMITS"
        ? 409
        : 400;
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status }
      );
    }
    throw error;
  }
});
