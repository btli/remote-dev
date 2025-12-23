import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
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
export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [userSettingsData, folderPreferencesData, folders] = await Promise.all([
      getUserSettings(session.user.id),
      getAllFolderPreferences(session.user.id),
      getFolders(session.user.id),
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

    // Handle stale session (user no longer exists in database)
    if (error instanceof PreferencesServiceError && error.code === "USER_NOT_FOUND") {
      return NextResponse.json(
        { error: "Session expired - please sign out and sign in again" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/preferences
 * Updates user settings
 */
export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updated = await updateUserSettings(session.user.id, filteredUpdates);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}
