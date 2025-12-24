import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { dirname, resolve } from "path";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees/check - Check worktree status (uncommitted changes, branch)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { worktreePath, repositoryId } = body;

  if (!worktreePath || !repositoryId) {
    return errorResponse("worktreePath and repositoryId are required", 400);
  }

  // Verify repository ownership
  const repository = await GitHubService.getRepository(repositoryId, userId);

  if (!repository?.localPath) {
    return errorResponse("Repository not found or not cloned", 404);
  }

  // Validate that worktreePath is within the repository's directory tree
  const repoDir = dirname(repository.localPath);
  const normalizedWorktreePath = resolve(worktreePath);
  if (!normalizedWorktreePath.startsWith(repoDir)) {
    return errorResponse("Invalid worktree path", 400);
  }

  // Check if it's a valid git repo/worktree
  const isRepo = await WorktreeService.isGitRepo(normalizedWorktreePath);
  if (!isRepo) {
    return errorResponse("Not a git repository or worktree", 400);
  }

  // Check for uncommitted changes
  const hasUncommittedChanges = await WorktreeService.hasUncommittedChanges(normalizedWorktreePath);

  // Get current branch
  const branch = await WorktreeService.getCurrentBranch(normalizedWorktreePath);

  return NextResponse.json({
    hasUncommittedChanges,
    branch,
  });
});
