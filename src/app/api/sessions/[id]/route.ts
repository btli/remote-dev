import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as WorktreeService from "@/services/worktree-service";
import * as GitHubService from "@/services/github-service";
import * as TrashService from "@/services/trash-service";
import * as ScheduleService from "@/services/schedule-service";
import { schedulerOrchestrator } from "@/services/scheduler-orchestrator";
import { getFolderPreferences } from "@/services/preferences-service";
import type { UpdateSessionInput } from "@/types/session";

/**
 * GET /api/sessions/:id - Get a single session
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const terminalSession = await SessionService.getSessionWithMetadata(
    params!.id,
    userId
  );

  if (!terminalSession) {
    return errorResponse("Session not found", 404);
  }

  return NextResponse.json(terminalSession);
});

/**
 * PATCH /api/sessions/:id - Update a session
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const updates: UpdateSessionInput = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.status !== undefined) updates.status = body.status;
  if (body.tabOrder !== undefined) updates.tabOrder = body.tabOrder;
  if (body.projectPath !== undefined) updates.projectPath = body.projectPath;

  try {
    const updated = await SessionService.updateSession(
      params!.id,
      userId,
      updates
    );
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});

/**
 * DELETE /api/sessions/:id - Close a session
 *
 * Query params:
 * - deleteWorktree=true: Also delete the git worktree from disk
 * - trash=true: Move worktree to trash instead of permanent close
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const id = params!.id;
  const { searchParams } = new URL(request.url);
  const deleteWorktree = searchParams.get("deleteWorktree") === "true";
  const shouldTrash = searchParams.get("trash") === "true";

  try {
    // Get session details for worktree operations
    const terminalSession = await SessionService.getSessionWithMetadata(
      id,
      userId
    );

    // Handle trash request for worktree sessions
    if (shouldTrash && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      const trashItem = await TrashService.trashResource(
        userId,
        "worktree",
        id
      );
      return NextResponse.json({ success: true, trashItemId: trashItem.id });
    }

    // If deleteWorktree is requested, handle worktree cleanup first
    if (deleteWorktree && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      let mainRepoPath: string | null = null;

      // Try to get the main repo path from GitHub repository
      if (terminalSession.githubRepoId) {
        const repo = await GitHubService.getRepository(
          terminalSession.githubRepoId,
          userId
        );
        mainRepoPath = repo?.localPath ?? null;
      }

      // Fall back to folder preferences for local repo path
      if (!mainRepoPath && terminalSession.folderId) {
        const folderPrefs = await getFolderPreferences(
          terminalSession.folderId,
          userId
        );
        mainRepoPath = folderPrefs?.localRepoPath ?? null;
      }

      if (mainRepoPath) {
        try {
          await WorktreeService.removeWorktree(
            mainRepoPath,
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

    // Disable any scheduled commands for this session
    try {
      const disabledCount = await ScheduleService.disableSessionSchedules(id);
      if (disabledCount > 0) {
        schedulerOrchestrator.removeSessionJobs(id);
        console.log(`Disabled ${disabledCount} schedules for session ${id}`);
      }
    } catch (scheduleError) {
      console.error("Failed to disable schedules:", scheduleError);
      // Continue with session closure even if schedule cleanup fails
    }

    await SessionService.closeSession(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    if (error instanceof TrashService.TrashServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    throw error;
  }
});
