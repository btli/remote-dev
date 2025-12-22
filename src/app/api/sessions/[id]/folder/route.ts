import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * PUT /api/sessions/:id/folder - Move a session to a folder (or remove from folder)
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  try {
    const sessionId = params?.id;
    if (!sessionId) return errorResponse("Session ID required", 400);

    const body = await request.json();
    const { folderId } = body;

    // folderId can be null (to remove from folder) or a string (to move to folder)
    if (folderId !== null && typeof folderId !== "string") {
      return errorResponse("folderId must be a string or null", 400);
    }

    const success = await FolderService.moveSessionToFolder(
      sessionId,
      userId,
      folderId
    );

    if (!success) {
      return errorResponse("Session not found", 404);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error moving session to folder:", error);
    return errorResponse("Failed to move session", 500);
  }
});
