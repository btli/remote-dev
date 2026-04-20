/**
 * Preferences Type Definitions
 *
 * Implements a layered inheritance system:
 * Default Constants -> User Preferences -> Parent Folders -> Child Folder
 *
 * Preferences cascade from ancestors to descendants, with more specific
 * (child) folders overriding less specific (parent) folders.
 */

import type { EnvironmentVariables } from "./environment";
import type { PinnedFile } from "./pinned-files";
import type { AgentProviderType } from "./session";

/**
 * Core preference keys that can be customized at any level
 */
export interface Preferences {
  defaultWorkingDirectory: string;
  defaultShell: string;
  theme: string;
  fontSize: number;
  fontFamily: string;
  startupCommand: string;
}

/**
 * Extended preferences including repository association
 * These are also inherited through the folder hierarchy
 */
export interface ExtendedPreferences extends Preferences {
  githubRepoId: string | null;
  localRepoPath: string | null;
  defaultAgentProvider: AgentProviderType | null;
}

/**
 * Partial preferences for overrides (all fields optional)
 */
export type PreferenceOverrides = Partial<Preferences>;

/**
 * Source of each preference value in the inheritance chain.
 * Can be a simple source type or a folder reference with metadata.
 */
export type PreferenceSource =
  | "default"
  | "user"
  | { type: "folder"; folderId: string; folderName: string };

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
  startupCommand: string | null;
  // Scrollback buffer settings (for performance tuning)
  xtermScrollback: number | null;
  tmuxHistoryLimit: number | null;
  activeNodeId: string | null;
  activeNodeType: "group" | "project" | null;
  pinnedNodeId: string | null;
  pinnedNodeType: "group" | "project" | null;
  autoFollowActiveSession: boolean;
  notificationsEnabled: boolean;
  // Beads issue tracker sidebar settings
  beadsSidebarCollapsed: boolean;
  beadsSidebarWidth: number | null;
  beadsClosedRetentionDays: number | null;
  beadsSectionExpanded: BeadsSectionExpandDefaults | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Default expand states for BeadsSidebar sections */
export interface BeadsSectionExpandDefaults {
  ready: boolean;
  inProgress: boolean;
  open: boolean;
  closed: boolean;
}

export const BEADS_SECTION_EXPAND_DEFAULTS: BeadsSectionExpandDefaults = {
  ready: true,
  inProgress: true,
  open: true,
  closed: false,
};

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
  startupCommand: string | null;
  // Repository association for worktree support
  githubRepoId: string | null;
  localRepoPath: string | null;
  // Default agent provider for issue worktrees
  defaultAgentProvider: AgentProviderType | null;
  // Environment variables (stored as JSON in database)
  // Use "__DISABLED__" value to explicitly disable an inherited variable
  environmentVars: EnvironmentVariables | null;
  // Pinned files for quick access in sidebar
  pinnedFiles: PinnedFile[] | null;
  // Git identity override for pseudonymous/anonymous commits
  gitIdentityName: string | null;
  gitIdentityEmail: string | null;
  // Sensitive folder flag — requires pseudonymous identity, enables push protection
  isSensitive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Folder with ancestry information for building inheritance chain
 */
export interface FolderWithAncestry {
  id: string;
  parentId: string | null;
  name: string;
}

/**
 * Folder preferences with folder metadata for inheritance chain
 */
export interface FolderPreferencesWithMeta extends FolderPreferences {
  folderName: string;
}

/**
 * Extended source tracking including repository fields.
 * Derived from ExtendedPreferences to ensure consistency.
 */
export type ExtendedPreferenceSourceMap = Record<keyof ExtendedPreferences, PreferenceSource>;

/**
 * Resolved preferences with inheritance chain metadata
 */
export interface ResolvedPreferences extends ExtendedPreferences {
  source: ExtendedPreferenceSourceMap;
  folderId: string | null;
  folderName: string | null;
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
  startupCommand?: string | null;
  // Scrollback buffer settings (for performance tuning)
  xtermScrollback?: number | null;
  tmuxHistoryLimit?: number | null;
  activeNodeId?: string | null;
  activeNodeType?: "group" | "project" | null;
  pinnedNodeId?: string | null;
  pinnedNodeType?: "group" | "project" | null;
  autoFollowActiveSession?: boolean;
  notificationsEnabled?: boolean;
  // Beads issue tracker sidebar settings
  beadsSidebarCollapsed?: boolean;
  beadsSidebarWidth?: number | null;
  beadsClosedRetentionDays?: number | null;
  beadsSectionExpanded?: BeadsSectionExpandDefaults | null;
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
  startupCommand?: string | null;
  // Repository association for worktree support
  githubRepoId?: string | null;
  localRepoPath?: string | null;
  // Default agent provider for issue worktrees
  defaultAgentProvider?: AgentProviderType | null;
  // Environment variables (stored as JSON in database)
  // Use "__DISABLED__" value to explicitly disable an inherited variable
  environmentVars?: EnvironmentVariables | null;
  // Pinned files for quick access in sidebar
  pinnedFiles?: PinnedFile[] | null;
  // Git identity override for pseudonymous/anonymous commits
  gitIdentityName?: string | null;
  gitIdentityEmail?: string | null;
  // Sensitive folder flag — requires pseudonymous identity, enables push protection
  isSensitive?: boolean;
}
