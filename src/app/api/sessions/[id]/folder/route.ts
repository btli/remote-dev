import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { broadcastSidebarChanged } from "@/lib/broadcast";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PUT /api/sessions/:id/folder - Move a session to a project (legacy "folder").
 *
 * Accepts `folderId` (legacy) and/or `projectId`. Both map to terminal_session.projectId.
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { folderId, projectId } = body as {
    folderId?: string | null;
    projectId?: string | null;
  };

  if (folderId !== undefined && folderId !== null && typeof folderId !== "string") {
    return errorResponse("folderId must be a string or null", 400);
  }
  if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
    return errorResponse("projectId must be a string or null", 400);
  }
  if (folderId === undefined && projectId === undefined) {
    return errorResponse("folderId or projectId is required", 400);
  }

  const resolvedProjectId =
    projectId !== undefined ? projectId : folderId ?? null;

  const result = await db
    .update(terminalSessions)
    .set({ projectId: resolvedProjectId })
    .where(
      and(
        eq(terminalSessions.id, params!.id),
        eq(terminalSessions.userId, userId)
      )
    );

  if ((result.rowsAffected ?? 0) === 0) {
    return errorResponse("Session not found", 404);
  }

  broadcastSidebarChanged(userId);
  return NextResponse.json({ success: true });
});
