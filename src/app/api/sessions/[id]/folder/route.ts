import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { moveSessionToFolderUseCase } from "@/infrastructure/container";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import { broadcastSidebarChanged } from "@/lib/broadcast";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { translateFolderIdToProjectId } from "@/services/project-scope-util";

/**
 * PUT /api/sessions/:id/folder - Move a session to a folder and/or project.
 *
 * Accepts `folderId` (legacy) and/or `projectId` (Phase 3+). Both paths dual-
 * write the corresponding bridge column on `terminal_session`.
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { folderId, projectId } = body as {
    folderId?: string | null;
    projectId?: string | null;
  };

  // folderId can be null (to remove from folder) or a string (to move to folder)
  if (folderId !== undefined && folderId !== null && typeof folderId !== "string") {
    return errorResponse("folderId must be a string or null", 400);
  }
  if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
    return errorResponse("projectId must be a string or null", 400);
  }
  if (folderId === undefined && projectId === undefined) {
    return errorResponse("folderId or projectId is required", 400);
  }

  try {
    if (folderId !== undefined) {
      await moveSessionToFolderUseCase.execute({
        sessionId: params!.id,
        userId,
        folderId,
      });
    }
    // Dual-write projectId: if caller supplied one, use it; else translate from
    // folderId (if the caller moved the session to a folder).
    const resolvedProjectId =
      projectId !== undefined
        ? projectId
        : folderId
          ? await translateFolderIdToProjectId(folderId, userId)
          : null;
    if (projectId !== undefined || folderId !== undefined) {
      await db
        .update(terminalSessions)
        .set({ projectId: resolvedProjectId })
        .where(
          and(
            eq(terminalSessions.id, params!.id),
            eq(terminalSessions.userId, userId)
          )
        );
    }
    broadcastSidebarChanged(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    throw error;
  }
});
