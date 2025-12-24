import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getUserSettings,
  updateUserSettings,
  getAllFolderPreferences,
  PreferencesServiceError,
} from "@/services/preferences-service";
import { getFolders } from "@/services/folder-service";

/**
 * GET /api/preferences
 * Returns user settings, all folder preferences, and active folder details
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const [userSettingsData, folderPreferencesData, folders] = await Promise.all([
      getUserSettings(userId),
      getAllFolderPreferences(userId),
      getFolders(userId),
    ]);

    // Find active folder details if set
    const activeFolderId =
      userSettingsData.pinnedFolderId || userSettingsData.activeFolderId;
    const activeFolder = activeFolderId
      ? folders.find((f) => f.id === activeFolderId) || null
      : null;

    return NextResponse.json({
      userSettings: userSettingsData,
      folderPreferences: folderPreferencesData,
      // Include all folders for client-side hierarchy building
      folders: folders.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
      })),
      activeFolder: activeFolder
        ? { id: activeFolder.id, name: activeFolder.name }
        : null,
    });
  } catch (error) {
    // Handle stale session (user no longer exists in database)
    if (error instanceof PreferencesServiceError && error.code === "USER_NOT_FOUND") {
      return errorResponse("Session expired - please sign out and sign in again", 401, "USER_NOT_FOUND");
    }
    throw error;
  }
});

/**
 * PATCH /api/preferences
 * Updates user settings
 */
export const PATCH = withAuth(async (request, { userId }) => {
  const updates = await request.json();

  // Validate updates
  const allowedFields = [
    "defaultWorkingDirectory",
    "defaultShell",
    "startupCommand",
    "theme",
    "fontSize",
    "fontFamily",
    "activeFolderId",
    "pinnedFolderId",
    "autoFollowActiveSession",
  ];

  const filteredUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      filteredUpdates[key] = value;
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    return errorResponse("No valid fields to update", 400);
  }

  const updated = await updateUserSettings(userId, filteredUpdates);
  return NextResponse.json(updated);
});
