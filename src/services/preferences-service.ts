/**
 * PreferencesService - Manages user and folder preferences with inheritance
 *
 * Inheritance chain: Default Constants -> User Preferences -> Folder Preferences
 */
import { db } from "@/db";
import { userSettings, folderPreferences, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  UserSettings,
  FolderPreferences,
  ResolvedPreferences,
  UpdateUserSettingsInput,
  UpdateFolderPreferencesInput,
} from "@/types/preferences";
import { PreferencesServiceError } from "@/lib/errors";
import {
  DEFAULT_PREFERENCES,
  resolvePreferences,
} from "@/lib/preferences";

export { PreferencesServiceError, DEFAULT_PREFERENCES, resolvePreferences };

// ============================================================================
// User Settings Operations
// ============================================================================

/**
 * Get user settings, creating default if not exists
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!settings) {
    // Create default settings for new user
    const [newSettings] = await db
      .insert(userSettings)
      .values({
        userId,
        defaultWorkingDirectory: DEFAULT_PREFERENCES.defaultWorkingDirectory,
        defaultShell: DEFAULT_PREFERENCES.defaultShell,
        theme: DEFAULT_PREFERENCES.theme,
        fontSize: DEFAULT_PREFERENCES.fontSize,
        fontFamily: DEFAULT_PREFERENCES.fontFamily,
        autoFollowActiveSession: true,
      })
      .returning();

    return mapDbUserSettings(newSettings);
  }

  return mapDbUserSettings(settings);
}

/**
 * Update user settings
 */
export async function updateUserSettings(
  userId: string,
  updates: UpdateUserSettingsInput
): Promise<UserSettings> {
  // Ensure settings exist first
  await getUserSettings(userId);

  const [updated] = await db
    .update(userSettings)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userId, userId))
    .returning();

  if (!updated) {
    throw new PreferencesServiceError(
      "Failed to update user settings",
      "UPDATE_FAILED"
    );
  }

  return mapDbUserSettings(updated);
}

/**
 * Set the active folder for quick terminal creation
 */
export async function setActiveFolder(
  userId: string,
  folderId: string | null,
  pinned: boolean = false
): Promise<UserSettings> {
  return updateUserSettings(userId, {
    activeFolderId: pinned ? null : folderId,
    pinnedFolderId: pinned ? folderId : null,
  });
}

// ============================================================================
// Folder Preferences Operations
// ============================================================================

/**
 * Get folder preferences (returns null if no overrides set)
 */
export async function getFolderPreferences(
  folderId: string,
  userId: string
): Promise<FolderPreferences | null> {
  const prefs = await db.query.folderPreferences.findFirst({
    where: and(
      eq(folderPreferences.folderId, folderId),
      eq(folderPreferences.userId, userId)
    ),
  });

  return prefs ? mapDbFolderPreferences(prefs) : null;
}

/**
 * Get all folder preferences for a user
 */
export async function getAllFolderPreferences(
  userId: string
): Promise<FolderPreferences[]> {
  const prefs = await db.query.folderPreferences.findMany({
    where: eq(folderPreferences.userId, userId),
  });

  return prefs.map(mapDbFolderPreferences);
}

/**
 * Update or create folder preferences
 */
export async function updateFolderPreferences(
  folderId: string,
  userId: string,
  updates: UpdateFolderPreferencesInput
): Promise<FolderPreferences> {
  // Check if folder exists and belongs to user
  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, folderId),
      eq(sessionFolders.userId, userId)
    ),
  });

  if (!folder) {
    throw new PreferencesServiceError("Folder not found", "FOLDER_NOT_FOUND");
  }

  const existing = await getFolderPreferences(folderId, userId);

  if (existing) {
    const [updated] = await db
      .update(folderPreferences)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(folderPreferences.folderId, folderId),
          eq(folderPreferences.userId, userId)
        )
      )
      .returning();

    return mapDbFolderPreferences(updated);
  } else {
    const [created] = await db
      .insert(folderPreferences)
      .values({
        folderId,
        userId,
        ...updates,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return mapDbFolderPreferences(created);
  }
}

/**
 * Delete folder preferences (revert to user defaults)
 */
export async function deleteFolderPreferences(
  folderId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(folderPreferences)
    .where(
      and(
        eq(folderPreferences.folderId, folderId),
        eq(folderPreferences.userId, userId)
      )
    );

  return result.rowsAffected > 0;
}

// ============================================================================
// Preference Resolution
// ============================================================================

/**
 * Get resolved preferences for a user and optional folder
 */
export async function getResolvedPreferences(
  userId: string,
  folderId?: string | null
): Promise<ResolvedPreferences> {
  const userSettingsData = await getUserSettings(userId);
  const folderPrefsData = folderId
    ? await getFolderPreferences(folderId, userId)
    : null;

  return resolvePreferences(userSettingsData, folderPrefsData);
}

/**
 * Get the effective active folder ID (considering pinned vs auto-follow)
 */
export async function getEffectiveActiveFolderId(
  userId: string,
  currentSessionFolderId?: string | null
): Promise<string | null> {
  const settings = await getUserSettings(userId);

  // If pinned, always use pinned folder
  if (settings.pinnedFolderId) {
    return settings.pinnedFolderId;
  }

  // If auto-follow is enabled and we have a current session folder, use it
  if (settings.autoFollowActiveSession && currentSessionFolderId) {
    return currentSessionFolderId;
  }

  // Otherwise use the stored active folder
  return settings.activeFolderId;
}

// ============================================================================
// Database Mappers
// ============================================================================

function mapDbUserSettings(
  db: typeof userSettings.$inferSelect
): UserSettings {
  return {
    id: db.id,
    userId: db.userId,
    defaultWorkingDirectory: db.defaultWorkingDirectory,
    defaultShell: db.defaultShell,
    theme: db.theme,
    fontSize: db.fontSize,
    fontFamily: db.fontFamily,
    activeFolderId: db.activeFolderId,
    pinnedFolderId: db.pinnedFolderId,
    autoFollowActiveSession: db.autoFollowActiveSession ?? true,
    createdAt: new Date(db.createdAt),
    updatedAt: new Date(db.updatedAt),
  };
}

function mapDbFolderPreferences(
  db: typeof folderPreferences.$inferSelect
): FolderPreferences {
  return {
    id: db.id,
    folderId: db.folderId,
    userId: db.userId,
    defaultWorkingDirectory: db.defaultWorkingDirectory,
    defaultShell: db.defaultShell,
    theme: db.theme,
    fontSize: db.fontSize,
    fontFamily: db.fontFamily,
    createdAt: new Date(db.createdAt),
    updatedAt: new Date(db.updatedAt),
  };
}
