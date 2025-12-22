/**
 * Shared preferences constants and utilities
 *
 * This module provides default preferences and the resolution logic
 * that can be used by both server-side services and client-side contexts.
 */

import type {
  Preferences,
  UserSettings,
  FolderPreferences,
  ResolvedPreferences,
  PreferenceSource,
} from "@/types/preferences";

/**
 * System-wide default preferences
 * Used as fallback when no user or folder preferences are set
 */
export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  defaultWorkingDirectory: typeof process !== "undefined" ? (process.env.HOME || "~") : "~",
  defaultShell: typeof process !== "undefined" ? (process.env.SHELL || "/bin/bash") : "/bin/bash",
  theme: "tokyo-night",
  fontSize: 14,
  fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
} as const;

/**
 * Resolve preferences with inheritance chain
 * Default -> User -> Folder
 *
 * This is a pure function that can be used on both server and client.
 */
export function resolvePreferences(
  userSettings: UserSettings | null,
  folderPrefs: FolderPreferences | null
): ResolvedPreferences {
  const source: Record<keyof Preferences, PreferenceSource> = {
    defaultWorkingDirectory: "default",
    defaultShell: "default",
    theme: "default",
    fontSize: "default",
    fontFamily: "default",
  };

  // Start with defaults
  const resolved: Preferences = { ...DEFAULT_PREFERENCES };

  // Apply user settings
  if (userSettings) {
    if (userSettings.defaultWorkingDirectory !== null) {
      resolved.defaultWorkingDirectory = userSettings.defaultWorkingDirectory;
      source.defaultWorkingDirectory = "user";
    }
    if (userSettings.defaultShell !== null) {
      resolved.defaultShell = userSettings.defaultShell;
      source.defaultShell = "user";
    }
    if (userSettings.theme !== null) {
      resolved.theme = userSettings.theme;
      source.theme = "user";
    }
    if (userSettings.fontSize !== null) {
      resolved.fontSize = userSettings.fontSize;
      source.fontSize = "user";
    }
    if (userSettings.fontFamily !== null) {
      resolved.fontFamily = userSettings.fontFamily;
      source.fontFamily = "user";
    }
  }

  // Apply folder overrides
  if (folderPrefs) {
    if (folderPrefs.defaultWorkingDirectory !== null) {
      resolved.defaultWorkingDirectory = folderPrefs.defaultWorkingDirectory;
      source.defaultWorkingDirectory = "folder";
    }
    if (folderPrefs.defaultShell !== null) {
      resolved.defaultShell = folderPrefs.defaultShell;
      source.defaultShell = "folder";
    }
    if (folderPrefs.theme !== null) {
      resolved.theme = folderPrefs.theme;
      source.theme = "folder";
    }
    if (folderPrefs.fontSize !== null) {
      resolved.fontSize = folderPrefs.fontSize;
      source.fontSize = "folder";
    }
    if (folderPrefs.fontFamily !== null) {
      resolved.fontFamily = folderPrefs.fontFamily;
      source.fontFamily = "folder";
    }
  }

  return {
    ...resolved,
    source,
    folderId: folderPrefs?.folderId || null,
  };
}
