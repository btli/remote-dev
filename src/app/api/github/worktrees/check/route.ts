import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees/check - Check worktree status (uncommitted changes, branch)
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { worktreePath } = body;

    if (!worktreePath) {
      return NextResponse.json(
        { error: "worktreePath is required" },
        { status: 400 }
      );
    }

    // Check if it's a valid git repo/worktree
    const isRepo = await WorktreeService.isGitRepo(worktreePath);
    if (!isRepo) {
      return NextResponse.json(
        { error: "Not a git repository or worktree" },
        { status: 400 }
      );
    }

    // Check for uncommitted changes
    const hasUncommittedChanges = await WorktreeService.hasUncommittedChanges(worktreePath);

    // Get current branch
    const branch = await WorktreeService.getCurrentBranch(worktreePath);

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
