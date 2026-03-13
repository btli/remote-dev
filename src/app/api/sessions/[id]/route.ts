import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import * as SessionService from "@/services/session-service";
import * as WorktreeService from "@/services/worktree-service";
import * as GitHubService from "@/services/github-service";
import * as TrashService from "@/services/trash-service";
import * as ScheduleService from "@/services/schedule-service";
import { notifySessionJobsRemoved } from "@/lib/scheduler-client";
import { getFolderPreferences } from "@/services/preferences-service";
import type { UpdateSessionInput, SessionStatus } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions");

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
  const result = await parseJsonBody<{
    name?: string;
    status?: string;
    pinned?: boolean;
    tabOrder?: number;
    projectPath?: string;
  }>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  const updates: UpdateSessionInput = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.status !== undefined) updates.status = body.status as SessionStatus;
  if (body.pinned !== undefined) updates.pinned = body.pinned;
  if (body.tabOrder !== undefined) updates.tabOrder = body.tabOrder;
  
  // SECURITY: Validate projectPath to prevent path traversal
  if (body.projectPath !== undefined) {
    const validatedPath = validateProjectPath(body.projectPath);
    if (body.projectPath && !validatedPath) {
      return errorResponse("Invalid project path", 400, "INVALID_PATH");
    }
    updates.projectPath = validatedPath;
  }

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
 * Resolve the main repository path for a worktree session.
 * Tries GitHub repo record first, then folder preferences.
 */
async function resolveMainRepoPath(
  session: { githubRepoId?: string | null; folderId?: string | null },
  userId: string
): Promise<string | null> {
  if (session.githubRepoId) {
    const repo = await GitHubService.getRepository(session.githubRepoId, userId);
    if (repo?.localPath) return repo.localPath;
  }

  if (session.folderId) {
    const folderPrefs = await getFolderPreferences(session.folderId, userId);
    if (folderPrefs?.localRepoPath) return folderPrefs.localRepoPath;
  }

  return null;
}

/**
 * DELETE /api/sessions/:id - Close a session
 *
 * Query params:
 * - deleteWorktree=true: Also delete the git worktree from disk
 * - trash=true: Move worktree to trash instead of permanent close
 * - cleanup=true: Full worktree cleanup (merge check, remove worktree, delete branches, close session)
 * - force=true: Skip merge verification when using cleanup mode
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const id = params!.id;
  const { searchParams } = new URL(request.url);
  const deleteWorktree = searchParams.get("deleteWorktree") === "true";
  const shouldTrash = searchParams.get("trash") === "true";
  const shouldCleanup = searchParams.get("cleanup") === "true";
  const force = searchParams.get("force") === "true";

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

    // Handle full worktree cleanup (merge check + remove worktree + delete branches + close)
    if (shouldCleanup && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      const mainRepoPath = await resolveMainRepoPath(terminalSession, userId);
      if (!mainRepoPath) {
        return errorResponse(
          "Cannot resolve main repository path for cleanup",
          400,
          "NO_REPO_PATH"
        );
      }

      // cleanupWorktree may throw BRANCH_NOT_MERGED (should not close session)
      // or REMOVE_FAILED. For other partial failures (e.g., worktree removed
      // but branch delete failed), cleanupWorktree handles them internally
      // and returns a result. We always close the session after a successful cleanup.
      const cleanupResult = await WorktreeService.cleanupWorktree(
        mainRepoPath,
        terminalSession.projectPath,
        terminalSession.worktreeBranch,
        force
      );
      log.info("Worktree cleanup completed", {
        sessionId: id,
        branch: terminalSession.worktreeBranch,
        message: cleanupResult.message,
      });

      // Disable any scheduled commands for this session
      try {
        const disabledCount = await ScheduleService.disableSessionSchedules(id);
        if (disabledCount > 0) {
          notifySessionJobsRemoved(id).catch((err) =>
            log.warn("Failed to notify scheduler of session job removal", { error: String(err) })
          );
          log.info("Disabled schedules for session", { disabledCount, sessionId: id });
        }
      } catch (scheduleError) {
        log.error("Failed to disable schedules", { error: String(scheduleError) });
      }

      // Close the session after successful cleanup.
      // If this fails, the worktree/branches are already cleaned up
      // but the session record remains — acceptable since a stale session
      // can be manually closed later.
      await SessionService.closeSession(id, userId);
      return NextResponse.json({ success: true, cleanup: cleanupResult });
    }

    // If deleteWorktree is requested, handle worktree cleanup first
    if (deleteWorktree && terminalSession?.worktreeBranch && terminalSession?.projectPath) {
      const mainRepoPath = await resolveMainRepoPath(terminalSession, userId);

      if (mainRepoPath) {
        try {
          const result = await WorktreeService.removeWorktree(
            mainRepoPath,
            terminalSession.projectPath,
            true // force removal
          );
          if (result.alreadyRemoved) {
            log.info("Worktree was already removed", { projectPath: terminalSession.projectPath });
          } else if (result.hadUncommittedChanges || result.hadUnpushedCommits) {
            log.warn("Removed worktree with data loss", { projectPath: terminalSession.projectPath, message: result.message });
          } else {
            log.info("Removed worktree for session", { projectPath: terminalSession.projectPath, sessionId: id });
          }
        } catch (worktreeError) {
          log.error("Failed to remove worktree", { error: String(worktreeError) });
          // Continue with session closure even if worktree removal fails
        }
      }
    }

    // Disable any scheduled commands for this session
    try {
      const disabledCount = await ScheduleService.disableSessionSchedules(id);
      if (disabledCount > 0) {
        // Notify terminal server's scheduler to remove the jobs
        notifySessionJobsRemoved(id).catch((err) =>
          log.warn("Failed to notify scheduler of session job removal", { error: String(err) })
        );
        log.info("Disabled schedules for session", { disabledCount, sessionId: id });
      }
    } catch (scheduleError) {
      log.error("Failed to disable schedules", { error: String(scheduleError) });
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

    if (error instanceof WorktreeService.WorktreeServiceError) {
      const status = error.code === "BRANCH_NOT_MERGED" ? 409 : 400;
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status }
      );
    }

    throw error;
  }
});
