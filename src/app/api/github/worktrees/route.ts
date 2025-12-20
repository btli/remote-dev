import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

/**
 * POST /api/github/worktrees - Create a git worktree for a branch
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { repositoryId, branch, createNewBranch, baseBranch } = body;

    if (!repositoryId || !branch) {
      return NextResponse.json(
        { error: "repositoryId and branch are required" },
        { status: 400 }
      );
    }

    const repository = await GitHubService.getRepository(
      repositoryId,
      session.user.id
    );

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    if (!repository.localPath) {
      return NextResponse.json(
        { error: "Repository not cloned. Clone it first.", code: "NOT_CLONED" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create worktree" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/github/worktrees - Remove a git worktree
 */
export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { repositoryId, worktreePath, force } = body;

    if (!repositoryId || !worktreePath) {
      return NextResponse.json(
        { error: "repositoryId and worktreePath are required" },
        { status: 400 }
      );
    }

    const repository = await GitHubService.getRepository(
      repositoryId,
      session.user.id
    );

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    if (!repository.localPath) {
      return NextResponse.json(
        { error: "Repository not cloned" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to remove worktree" },
      { status: 500 }
    );
  }
}
