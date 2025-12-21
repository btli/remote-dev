import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as SessionService from "@/services/session-service";
import * as WorktreeService from "@/services/worktree-service";
import * as GitHubService from "@/services/github-service";
import type { UpdateSessionInput } from "@/types/session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/sessions/:id - Get a single session
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const terminalSession = await SessionService.getSessionWithMetadata(
      id,
      session.user.id
    );

    if (!terminalSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(terminalSession);
  } catch (error) {
    console.error("Error getting session:", error);
    return NextResponse.json(
      { error: "Failed to get session" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/sessions/:id - Update a session
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const updates: UpdateSessionInput = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.tabOrder !== undefined) updates.tabOrder = body.tabOrder;
    if (body.projectPath !== undefined) updates.projectPath = body.projectPath;

    const updated = await SessionService.updateSession(
      id,
      session.user.id,
      updates
    );

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sessions/:id - Close a session
 *
 * Query params:
 * - deleteWorktree=true: Also delete the git worktree from disk
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteWorktree = searchParams.get("deleteWorktree") === "true";

    // If deleteWorktree is requested, handle worktree cleanup first
    if (deleteWorktree) {
      const terminalSession = await SessionService.getSessionWithMetadata(
        id,
        session.user.id
      );

      if (terminalSession?.worktreeBranch && terminalSession?.projectPath) {
        // Get the main repo path from the github repository
        if (terminalSession.githubRepoId) {
          const repo = await GitHubService.getRepository(
            terminalSession.githubRepoId,
            session.user.id
          );

          if (repo?.localPath) {
            try {
              await WorktreeService.removeWorktree(
                repo.localPath,
                terminalSession.projectPath,
                true // force removal
              );
              console.log(
                `Removed worktree at ${terminalSession.projectPath} for session ${id}`
              );
            } catch (worktreeError) {
              console.error("Failed to remove worktree:", worktreeError);
              // Continue with session closure even if worktree removal fails
            }
          }
        }
      }
    }

    await SessionService.closeSession(id, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error closing session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    return NextResponse.json(
      { error: "Failed to close session" },
      { status: 500 }
    );
  }
}
