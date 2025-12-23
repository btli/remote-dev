/**
 * Shared preferences constants and utilities
 *
 * This module provides default preferences and the resolution logic
 * that can be used by both server-side services and client-side contexts.
 *
 * Implements hierarchical inheritance:
 * Default -> User -> Grandparent Folder -> Parent Folder -> Child Folder
 *
 * More specific (child) folders override less specific (parent) folders.
 */

import type {
  Preferences,
  ExtendedPreferences,
  UserSettings,
  FolderPreferences,
  FolderPreferencesWithMeta,
  FolderWithAncestry,
  ResolvedPreferences,
  PreferenceSource,
  ExtendedPreferenceSourceMap,
} from "@/types/preferences";

/**
 * System-wide default preferences
 * Used as fallback when no user or folder preferences are set
 *
 * Note: Environment checks (typeof process !== "undefined") ensure this module
 * works in both server (Node.js) and client (browser) contexts. On the server,
 * defaultWorkingDirectory and defaultShell use environment variables. On the
 * client, they fall back to "~" and "/bin/bash" respectively. These client-side
 * values are only used for display; actual session creation uses server-resolved values.
 */
export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  defaultWorkingDirectory: typeof process !== "undefined" ? (process.env.HOME || "~") : "~",
  defaultShell: typeof process !== "undefined" ? (process.env.SHELL || "/bin/bash") : "/bin/bash",
  theme: "tokyo-night",
  fontSize: 14,
  fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
  startupCommand: "",
} as const;

/**
 * Build the ancestry chain for a folder, from root ancestor to target folder.
 *
 * This function traverses the folder hierarchy upward from the target folder,
 * then reverses the result to get ancestor-first ordering. This ordering
 * ensures that child folder preferences override parent folder preferences.
 *
 * @param folderId - Target folder ID to build chain for
 * @param folderPrefsMap - Map of folderId to FolderPreferences
 * @param foldersMap - Map of folderId to folder metadata (for parentId lookup)
 * @returns Array of FolderPreferencesWithMeta from root ancestor to target folder
 */
export function buildAncestryChain(
  folderId: string,
  folderPrefsMap: Map<string, FolderPreferences>,
  foldersMap: Map<string, FolderWithAncestry>
): FolderPreferencesWithMeta[] {
  const visited = new Set<string>();
  const reverseChain: FolderPreferencesWithMeta[] = [];

  let currentId: string | null = folderId;

  // Walk up the parent chain from target to root
  while (currentId) {
    // Circular reference protection
    if (visited.has(currentId)) {
      console.warn("Circular reference detected in folder hierarchy at:", currentId);
      break;
    }
    visited.add(currentId);

    const folder = foldersMap.get(currentId);
    if (!folder) break;

    const prefs = folderPrefsMap.get(currentId);
    if (prefs) {
      // Only include folders that have preferences set
      reverseChain.push({
        ...prefs,
        folderName: folder.name,
      });
    }

    currentId = folder.parentId;
  }

  // Reverse to get ancestor-first order (grandparent -> parent -> child)
  return reverseChain.reverse();
}

/**
 * Create a folder source reference for the preference source map
 */
function folderSource(folderId: string, folderName: string): PreferenceSource {
  return { type: "folder", folderId, folderName };
}

/**
 * Resolve preferences with hierarchical inheritance chain
 * Default -> User -> Grandparent -> Parent -> Child
 *
 * Each preference value comes from the most specific level that defines it.
 * The returned object includes a `source` map indicating where each
 * preference value originated, useful for UI indicators showing inheritance.
 *
 * This is a pure function that can be used on both server and client.
 *
 * @param userSettings - User-level preferences (null if not loaded)
 * @param folderPrefsChain - Ordered array of folder preferences from ancestor to target
 * @returns Resolved preferences with source tracking, including repository association
 */
export function resolvePreferences(
  userSettings: UserSettings | null,
  folderPrefsChain: FolderPreferencesWithMeta[]
): ResolvedPreferences {
  // Initialize source tracking for all preference keys
  const source: ExtendedPreferenceSourceMap = {
    defaultWorkingDirectory: "default",
    defaultShell: "default",
    theme: "default",
    fontSize: "default",
    fontFamily: "default",
    startupCommand: "default",
    githubRepoId: "default",
    localRepoPath: "default",
  };

  // Start with defaults (extended to include repo fields)
  const resolved: ExtendedPreferences = {
    ...DEFAULT_PREFERENCES,
    githubRepoId: null,
    localRepoPath: null,
  };

  // Layer 1: Apply user settings
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
    if (userSettings.startupCommand !== null) {
      resolved.startupCommand = userSettings.startupCommand;
      source.startupCommand = "user";
    }
  }

  // Layer 2+: Apply folder chain (ancestors first, then children override)
  // This means the last folder in the chain (most specific) has highest priority
  for (const folderPrefs of folderPrefsChain) {
    const folderRef = folderSource(folderPrefs.folderId, folderPrefs.folderName);

    if (folderPrefs.defaultWorkingDirectory !== null) {
      resolved.defaultWorkingDirectory = folderPrefs.defaultWorkingDirectory;
      source.defaultWorkingDirectory = folderRef;
    }
    if (folderPrefs.defaultShell !== null) {
      resolved.defaultShell = folderPrefs.defaultShell;
      source.defaultShell = folderRef;
    }
    if (folderPrefs.theme !== null) {
      resolved.theme = folderPrefs.theme;
      source.theme = folderRef;
    }
    if (folderPrefs.fontSize !== null) {
      resolved.fontSize = folderPrefs.fontSize;
      source.fontSize = folderRef;
    }
    if (folderPrefs.fontFamily !== null) {
      resolved.fontFamily = folderPrefs.fontFamily;
      source.fontFamily = folderRef;
    }
    if (folderPrefs.startupCommand !== null) {
      resolved.startupCommand = folderPrefs.startupCommand;
      source.startupCommand = folderRef;
    }
    // Repository association also inherits
    if (folderPrefs.githubRepoId !== null) {
      resolved.githubRepoId = folderPrefs.githubRepoId;
      source.githubRepoId = folderRef;
    }
    if (folderPrefs.localRepoPath !== null) {
      resolved.localRepoPath = folderPrefs.localRepoPath;
      source.localRepoPath = folderRef;
    }
  }

  // Get the target folder (last in chain) for folderId/folderName
  const targetFolder = folderPrefsChain[folderPrefsChain.length - 1];

  return {
    ...resolved,
    source,
    folderId: targetFolder?.folderId || null,
    folderName: targetFolder?.folderName || null,
  };
}

/**
 * Helper to check if a preference source is from a folder
 */
export function isFromFolder(source: PreferenceSource): source is { type: "folder"; folderId: string; folderName: string } {
  return typeof source === "object" && source.type === "folder";
}

/**
 * Get a human-readable label for a preference source
 */
export function getSourceLabel(source: PreferenceSource): string {
  if (source === "default") return "Default";
  if (source === "user") return "User settings";
  if (isFromFolder(source)) return `Inherited from: ${source.folderName}`;
  return "Unknown";
}
