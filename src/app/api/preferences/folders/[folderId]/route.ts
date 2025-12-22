import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getFolderPreferences,
  updateFolderPreferences,
  deleteFolderPreferences,
} from "@/services/preferences-service";

/**
 * GET /api/preferences/folders/[folderId]
 * Returns folder-specific preference overrides
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const folderId = params?.folderId;
  if (!folderId) return errorResponse("Folder ID required", 400);

  try {
    const prefs = await getFolderPreferences(folderId, userId);
    if (!prefs) {
      return errorResponse("Not found", 404);
    }
    return NextResponse.json(prefs);
  } catch (error) {
    console.error("Error fetching folder preferences:", error);
    return errorResponse("Failed to fetch folder preferences", 500);
  }
});

/**
 * PUT /api/preferences/folders/[folderId]
 * Creates or updates folder-specific preference overrides
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const folderId = params?.folderId;
  if (!folderId) return errorResponse("Folder ID required", 400);

  try {
    const updates = await request.json();

    // Validate updates
    const allowedFields = [
      "defaultWorkingDirectory",
      "defaultShell",
      "theme",
      "fontSize",
      "fontFamily",
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = value;
      }
    }

    const updated = await updateFolderPreferences(
      folderId,
      userId,
      filteredUpdates
    );
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating folder preferences:", error);
    if (error instanceof Error && error.message === "Folder not found") {
      return errorResponse("Folder not found", 404);
    }
    return errorResponse("Failed to update folder preferences", 500);
  }
});

/**
 * DELETE /api/preferences/folders/[folderId]
 * Removes folder-specific preference overrides (reverts to user defaults)
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const folderId = params?.folderId;
  if (!folderId) return errorResponse("Folder ID required", 400);

  try {
    const deleted = await deleteFolderPreferences(folderId, userId);
    if (!deleted) {
      return errorResponse("Not found", 404);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder preferences:", error);
    return errorResponse("Failed to delete folder preferences", 500);
  }
});
