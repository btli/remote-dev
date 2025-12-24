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
  const prefs = await getFolderPreferences(params!.folderId, userId);
  if (!prefs) {
    return errorResponse("Not found", 404);
  }
  return NextResponse.json(prefs);
});

/**
 * PUT /api/preferences/folders/[folderId]
 * Creates or updates folder-specific preference overrides
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const updates = await request.json();

  // Validate updates
  const allowedFields = [
    "defaultWorkingDirectory",
    "defaultShell",
    "startupCommand",
    "theme",
    "fontSize",
    "fontFamily",
    "githubRepoId",
    "localRepoPath",
  ];

  const filteredUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      filteredUpdates[key] = value;
    }
  }

  try {
    const updated = await updateFolderPreferences(
      params!.folderId,
      userId,
      filteredUpdates
    );
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Folder not found") {
      return errorResponse("Folder not found", 404);
    }
    throw error;
  }
});

/**
 * DELETE /api/preferences/folders/[folderId]
 * Removes folder-specific preference overrides (reverts to user defaults)
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await deleteFolderPreferences(params!.folderId, userId);
  if (!deleted) {
    return errorResponse("Not found", 404);
  }
  return NextResponse.json({ success: true });
});
