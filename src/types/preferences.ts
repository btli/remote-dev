/**
 * Preferences Type Definitions
 *
 * Implements a layered inheritance system:
 * Default Constants -> User Preferences -> Folder Preferences
 */

/**
 * Core preference keys that can be customized at any level
 */
export interface Preferences {
  defaultWorkingDirectory: string;
  defaultShell: string;
  theme: string;
  fontSize: number;
  fontFamily: string;
}

/**
 * Source of each preference value in the inheritance chain
 */
export type PreferenceSource = "default" | "user" | "folder";

/**
 * User-level settings stored in database
 */
export interface UserSettings {
  id: string;
  userId: string;
  defaultWorkingDirectory: string | null;
  defaultShell: string | null;
  theme: string | null;
  fontSize: number | null;
  fontFamily: string | null;
  activeFolderId: string | null;
  pinnedFolderId: string | null;
  autoFollowActiveSession: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Folder-level preference overrides stored in database
 */
export interface FolderPreferences {
  id: string;
  folderId: string;
  userId: string;
  defaultWorkingDirectory: string | null;
  defaultShell: string | null;
  theme: string | null;
  fontSize: number | null;
  fontFamily: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolved preferences with inheritance chain metadata
 */
export interface ResolvedPreferences extends Preferences {
  source: Record<keyof Preferences, PreferenceSource>;
  folderId: string | null;
}

/**
 * Active project state for UI display
 */
export interface ActiveProject {
  folderId: string | null;
  folderName: string | null;
  isPinned: boolean;
}

/**
 * Input for updating user settings
 */
export interface UpdateUserSettingsInput {
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  activeFolderId?: string | null;
  pinnedFolderId?: string | null;
  autoFollowActiveSession?: boolean;
}

/**
 * Input for updating folder preferences
 */
export interface UpdateFolderPreferencesInput {
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
}
