/**
 * PreferencesService - Manages user and folder preferences with inheritance
 *
 * Inheritance chain: Default Constants -> User Preferences -> Folder Preferences
 */
import { db } from "@/db";
import { users, userSettings, folderPreferences, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  Preferences,
  UserSettings,
  FolderPreferences,
  ResolvedPreferences,
  PreferenceSource,
  UpdateUserSettingsInput,
  UpdateFolderPreferencesInput,
} from "@/types/preferences";
import { PreferencesServiceError } from "@/lib/errors";

// Re-export for backwards compatibility
export { PreferencesServiceError };

/**
 * System-wide default preferences
 */
export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  defaultWorkingDirectory: process.env.HOME || "~",
  defaultShell: process.env.SHELL || "/bin/bash",
  theme: "tokyo-night",
  fontSize: 14,
  fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
  startupCommand: "",
} as const;

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
    // Verify user exists before creating settings (prevents FK constraint errors
    // from stale session cookies referencing deleted users)
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new PreferencesServiceError(
        "User not found - session may be stale, please re-login",
        "USER_NOT_FOUND"
      );
    }

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
 * Resolve preferences with inheritance chain
 * Default -> User -> Folder
 */
export function resolvePreferences(
  userSettingsData: UserSettings,
  folderPrefsData: FolderPreferences | null
): ResolvedPreferences {
  const source: Record<keyof Preferences, PreferenceSource> = {
    defaultWorkingDirectory: "default",
    defaultShell: "default",
    theme: "default",
    fontSize: "default",
    fontFamily: "default",
    startupCommand: "default",
  };

  // Start with defaults
  const resolved: Preferences = { ...DEFAULT_PREFERENCES };

  // Apply user settings
  if (userSettingsData.defaultWorkingDirectory !== null) {
    resolved.defaultWorkingDirectory = userSettingsData.defaultWorkingDirectory;
    source.defaultWorkingDirectory = "user";
  }
  if (userSettingsData.defaultShell !== null) {
    resolved.defaultShell = userSettingsData.defaultShell;
    source.defaultShell = "user";
  }
  if (userSettingsData.theme !== null) {
    resolved.theme = userSettingsData.theme;
    source.theme = "user";
  }
  if (userSettingsData.fontSize !== null) {
    resolved.fontSize = userSettingsData.fontSize;
    source.fontSize = "user";
  }
  if (userSettingsData.fontFamily !== null) {
    resolved.fontFamily = userSettingsData.fontFamily;
    source.fontFamily = "user";
  }
  if (userSettingsData.startupCommand !== null) {
    resolved.startupCommand = userSettingsData.startupCommand;
    source.startupCommand = "user";
  }

  // Apply folder overrides
  if (folderPrefsData) {
    if (folderPrefsData.defaultWorkingDirectory !== null) {
      resolved.defaultWorkingDirectory = folderPrefsData.defaultWorkingDirectory;
      source.defaultWorkingDirectory = "folder";
    }
    if (folderPrefsData.defaultShell !== null) {
      resolved.defaultShell = folderPrefsData.defaultShell;
      source.defaultShell = "folder";
    }
    if (folderPrefsData.theme !== null) {
      resolved.theme = folderPrefsData.theme;
      source.theme = "folder";
    }
    if (folderPrefsData.fontSize !== null) {
      resolved.fontSize = folderPrefsData.fontSize;
      source.fontSize = "folder";
    }
    if (folderPrefsData.fontFamily !== null) {
      resolved.fontFamily = folderPrefsData.fontFamily;
      source.fontFamily = "folder";
    }
    if (folderPrefsData.startupCommand !== null) {
      resolved.startupCommand = folderPrefsData.startupCommand;
      source.startupCommand = "folder";
    }
  }

  return {
    ...resolved,
    source,
    folderId: folderPrefsData?.folderId || null,
  };
}

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
    startupCommand: db.startupCommand,
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
    startupCommand: db.startupCommand,
    theme: db.theme,
    fontSize: db.fontSize,
    fontFamily: db.fontFamily,
    githubRepoId: db.githubRepoId,
    localRepoPath: db.localRepoPath,
    createdAt: new Date(db.createdAt),
    updatedAt: new Date(db.updatedAt),
  };
}
