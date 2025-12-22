import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getUserSettings,
  updateUserSettings,
  getAllFolderPreferences,
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
      activeFolder: activeFolder
        ? { id: activeFolder.id, name: activeFolder.name }
        : null,
    });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return errorResponse("Failed to fetch preferences", 500);
  }
});

/**
 * PATCH /api/preferences
 * Updates user settings
 */
export const PATCH = withAuth(async (request, { userId }) => {
  try {
    const updates = await request.json();

    // Validate updates
    const allowedFields = [
      "defaultWorkingDirectory",
      "defaultShell",
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
  } catch (error) {
    console.error("Error updating preferences:", error);
    return errorResponse("Failed to update preferences", 500);
  }
});
