import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { validateEnvironmentVars } from "@/lib/api-validation";
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
 * Creates or updates folder-specific preference overrides.
 *
 * When environmentVars are included, the response includes port validation
 * with any detected conflicts and suggested alternatives.
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
    "environmentVars",
    "pinnedFiles",
  ];

  const filteredUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      // Special validation for environmentVars
      if (key === "environmentVars") {
        const validation = validateEnvironmentVars(value);
        if (!validation.valid) {
          return errorResponse(validation.error, 400);
        }
        filteredUpdates[key] = validation.value;
      } else {
        filteredUpdates[key] = value;
      }
    }
  }

  try {
    const result = await updateFolderPreferences(
      params!.folderId,
      userId,
      filteredUpdates
    );

    // Return preferences with port validation if env vars were updated
    return NextResponse.json({
      ...result.preferences,
      portValidation: result.portValidation,
    });
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
