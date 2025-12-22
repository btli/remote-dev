import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { dirname, resolve } from "path";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees/check - Check worktree status (uncommitted changes, branch)
 */
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { worktreePath, repositoryId } = body;

    if (!worktreePath || !repositoryId) {
      return NextResponse.json(
        { error: "worktreePath and repositoryId are required" },
        { status: 400 }
      );
    }

    // Verify repository ownership
    const repository = await GitHubService.getRepository(
      repositoryId,
      session.user.id
    );

    if (!repository?.localPath) {
      return NextResponse.json(
        { error: "Repository not found or not cloned" },
        { status: 404 }
      );
    }

    // Validate that worktreePath is within the repository's directory tree
    const repoDir = dirname(repository.localPath);
    const normalizedWorktreePath = resolve(worktreePath);
    if (!normalizedWorktreePath.startsWith(repoDir)) {
      return NextResponse.json(
        { error: "Invalid worktree path" },
        { status: 400 }
      );
    }

    // Check if it's a valid git repo/worktree
    const isRepo = await WorktreeService.isGitRepo(normalizedWorktreePath);
    if (!isRepo) {
      return NextResponse.json(
        { error: "Not a git repository or worktree" },
        { status: 400 }
      );
    }

    // Check for uncommitted changes
    const hasUncommittedChanges = await WorktreeService.hasUncommittedChanges(normalizedWorktreePath);

    // Get current branch
    const branch = await WorktreeService.getCurrentBranch(normalizedWorktreePath);

    return NextResponse.json({
      hasUncommittedChanges,
      branch,
    });
  } catch (error) {
    console.error("Error checking worktree:", error);
    return NextResponse.json(
      { error: "Failed to check worktree status" },
      { status: 500 }
    );
  }
}
