/**
 * PreferencesService - Manages user and folder preferences with hierarchical inheritance
 *
 * Inheritance chain: Default Constants -> User Preferences -> Parent Folders -> Child Folder
 *
 * More specific (child) folders override less specific (parent) folders.
 */
import { db } from "@/db";
import { users, userSettings, nodePreferences, projects, projectGroups } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  UserSettings,
  FolderPreferences,
  FolderPreferencesWithMeta,
  FolderWithAncestry,
  ResolvedPreferences,
  UpdateUserSettingsInput,
  UpdateFolderPreferencesInput,
} from "@/types/preferences";
import type { PortValidationResult } from "@/types/environment";
import { BEADS_SECTION_EXPAND_DEFAULTS, type BeadsSectionExpandDefaults } from "@/types/preferences";
import { safeJsonParse } from "@/lib/utils";
import { PreferencesServiceError } from "@/lib/errors";
import {
  DEFAULT_PREFERENCES,
  resolvePreferences,
  buildAncestryChain,
} from "@/lib/preferences";
import {
  parseEnvironmentVars,
  serializeEnvironmentVars,
} from "@/lib/environment";
import {
  parsePinnedFiles,
  serializePinnedFiles,
} from "@/types/pinned-files";
import {
  syncPortRegistry,
  validatePorts,
  deletePortsForFolder,
} from "@/services/port-registry-service";

// Re-export for backwards compatibility
export { PreferencesServiceError, DEFAULT_PREFERENCES };

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
        notificationsEnabled: true,
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

  // Serialize beadsSectionExpanded to JSON string for TEXT column
  const dbUpdates: Record<string, unknown> = { ...updates };
  if (updates.beadsSectionExpanded !== undefined) {
    dbUpdates.beadsSectionExpanded = updates.beadsSectionExpanded
      ? JSON.stringify(updates.beadsSectionExpanded)
      : null;
  }

  const [updated] = await db
    .update(userSettings)
    .set({
      ...dbUpdates,
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
  // Translate legacy "folderId" to the new node-based representation.
  // With the project refactor, this is expected to be a project id.
  return updateUserSettings(userId, {
    activeNodeId: pinned ? null : folderId,
    activeNodeType: pinned ? null : folderId ? "project" : null,
    pinnedNodeId: pinned ? folderId : null,
    pinnedNodeType: pinned && folderId ? "project" : null,
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
  // After the project refactor, folderId is treated as a project id.
  const prefs = await db.query.nodePreferences.findFirst({
    where: and(
      eq(nodePreferences.ownerId, folderId),
      eq(nodePreferences.ownerType, "project"),
      eq(nodePreferences.userId, userId)
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
  const prefs = await db.query.nodePreferences.findMany({
    where: eq(nodePreferences.userId, userId),
  });

  return prefs.map(mapDbFolderPreferences);
}

/**
 * Get all folders for a user (for building hierarchy)
 *
 * After the project refactor, this returns project nodes with their
 * parent project group as the "parent" of the ancestry chain.
 */
export async function getAllFolders(
  userId: string
): Promise<FolderWithAncestry[]> {
  const [allProjects, allGroups] = await Promise.all([
    db.query.projects.findMany({ where: eq(projects.userId, userId) }),
    db.query.projectGroups.findMany({ where: eq(projectGroups.userId, userId) }),
  ]);

  const result: FolderWithAncestry[] = [];
  for (const g of allGroups) {
    result.push({ id: g.id, parentId: g.parentGroupId ?? null, name: g.name });
  }
  for (const p of allProjects) {
    result.push({ id: p.id, parentId: p.groupId, name: p.name });
  }
  return result;
}

/**
 * Get folder preferences chain including all ancestors.
 * Returns an ordered array from root ancestor to target folder.
 */
export async function getFolderPreferencesChain(
  folderId: string,
  userId: string
): Promise<FolderPreferencesWithMeta[]> {
  // Fetch all folders and preferences for this user
  const [allFolders, allPrefs] = await Promise.all([
    getAllFolders(userId),
    getAllFolderPreferences(userId),
  ]);

  // Build maps for the shared chain builder
  const foldersMap = new Map(allFolders.map((f) => [f.id, f]));
  const prefsMap = new Map(allPrefs.map((p) => [p.folderId, p]));

  // Use shared utility to build the chain
  return buildAncestryChain(folderId, prefsMap, foldersMap);
}

/**
 * Result of updating folder preferences, including port validation.
 */
export interface UpdateFolderPreferencesResult {
  preferences: FolderPreferences;
  portValidation: PortValidationResult;
}

/**
 * Update or create folder preferences.
 *
 * When environmentVars are updated, also syncs the port registry
 * and returns port conflict validation.
 */
export async function updateFolderPreferences(
  folderId: string,
  userId: string,
  updates: UpdateFolderPreferencesInput
): Promise<UpdateFolderPreferencesResult> {
  // After the project refactor, folderId must correspond to a project
  // or group node. We check both.
  const [project, group] = await Promise.all([
    db.query.projects.findFirst({
      where: and(eq(projects.id, folderId), eq(projects.userId, userId)),
    }),
    db.query.projectGroups.findFirst({
      where: and(eq(projectGroups.id, folderId), eq(projectGroups.userId, userId)),
    }),
  ]);

  if (!project && !group) {
    throw new PreferencesServiceError("Folder not found", "FOLDER_NOT_FOUND");
  }

  const ownerType: "group" | "project" = project ? "project" : "group";

  // Prepare database values - serialize JSON fields
  const dbUpdates: Record<string, unknown> = { ...updates };
  if ("environmentVars" in updates) {
    dbUpdates.environmentVars = serializeEnvironmentVars(updates.environmentVars);
  }
  if ("pinnedFiles" in updates) {
    dbUpdates.pinnedFiles = serializePinnedFiles(updates.pinnedFiles ?? null);
  }

  const existing = await getFolderPreferences(folderId, userId);
  let result: FolderPreferences;

  if (existing) {
    const [updated] = await db
      .update(nodePreferences)
      .set({
        ...dbUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(nodePreferences.ownerId, folderId),
          eq(nodePreferences.ownerType, ownerType),
          eq(nodePreferences.userId, userId)
        )
      )
      .returning();

    result = mapDbFolderPreferences(updated);
  } else {
    const [created] = await db
      .insert(nodePreferences)
      .values({
        id: crypto.randomUUID(),
        ownerId: folderId,
        ownerType,
        userId,
        ...dbUpdates,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    result = mapDbFolderPreferences(created);
  }

  // Validate ports BEFORE syncing to detect conflicts against committed state
  // This prevents TOCTOU issues where concurrent updates could miss conflicts
  const portValidation = await validatePorts(
    folderId,
    userId,
    result.environmentVars
  );

  // Sync port registry if environmentVars were updated
  if ("environmentVars" in updates) {
    await syncPortRegistry(folderId, userId, updates.environmentVars ?? null);
  }

  return {
    preferences: result,
    portValidation,
  };
}

/**
 * Delete folder preferences (revert to user defaults).
 *
 * Also cleans up the port registry for this folder.
 */
export async function deleteFolderPreferences(
  folderId: string,
  userId: string
): Promise<boolean> {
  // Clean up port registry first
  await deletePortsForFolder(folderId, userId);

  const result = await db
    .delete(nodePreferences)
    .where(
      and(
        eq(nodePreferences.ownerId, folderId),
        eq(nodePreferences.userId, userId)
      )
    );

  return result.rowsAffected > 0;
}

// ============================================================================
// Preference Resolution
// ============================================================================

/**
 * Get resolved preferences for a user and optional folder.
 * Includes hierarchical inheritance from parent folders.
 */
export async function getResolvedPreferences(
  userId: string,
  folderId?: string | null
): Promise<ResolvedPreferences> {
  const userSettingsData = await getUserSettings(userId);
  const folderPrefsChain = folderId
    ? await getFolderPreferencesChain(folderId, userId)
    : [];

  return resolvePreferences(userSettingsData, folderPrefsChain);
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
  if (settings.pinnedNodeId) {
    return settings.pinnedNodeId;
  }

  // If auto-follow is enabled and we have a current session folder, use it
  if (settings.autoFollowActiveSession && currentSessionFolderId) {
    return currentSessionFolderId;
  }

  // Otherwise use the stored active folder
  return settings.activeNodeId;
}

/**
 * Get resolved environment variables for a folder.
 *
 * Resolves environment variables through the folder hierarchy,
 * handling overrides and disabled variables.
 *
 * @param userId - User ID for ownership verification
 * @param folderId - Folder ID to resolve environment for
 * @returns Resolved environment or null if no folder specified
 */
export async function getResolvedEnvironment(
  userId: string,
  folderId?: string | null
): Promise<import("@/types/environment").ResolvedEnvironment | null> {
  if (!folderId) {
    return null;
  }

  const { resolveEnvironmentVariables } = await import("@/lib/environment");

  const folderPrefsChain = await getFolderPreferencesChain(folderId, userId);

  // User-level env vars not currently supported (could be added later)
  return resolveEnvironmentVariables(null, folderPrefsChain);
}

/**
 * Get the final environment variables for a terminal session.
 *
 * Resolves folder environment and returns just the merged variables
 * (not the full ResolvedEnvironment with metadata).
 *
 * @param userId - User ID
 * @param folderId - Optional folder ID
 * @returns Record of environment variables or null
 */
export async function getEnvironmentForSession(
  userId: string,
  folderId?: string | null
): Promise<Record<string, string> | null> {
  const resolved = await getResolvedEnvironment(userId, folderId);
  return resolved?.variables ?? null;
}

/**
 * Resolve git identity override for a folder.
 *
 * Walks the folder ancestry chain to find the nearest folder with a git identity
 * configured (child overrides parent). Returns the identity as env vars that
 * override GIT_AUTHOR_NAME/EMAIL and GIT_COMMITTER_NAME/EMAIL.
 *
 * Also returns the sensitive flag from the nearest folder that has it set.
 */
export async function getFolderGitIdentity(
  userId: string,
  folderId?: string | null
): Promise<{
  env: Record<string, string> | null;
  isSensitive: boolean;
  gitIdentityName: string | null;
  gitIdentityEmail: string | null;
}> {
  if (!folderId) {
    return { env: null, isSensitive: false, gitIdentityName: null, gitIdentityEmail: null };
  }

  const chain = await getFolderPreferencesChain(folderId, userId);

  // Any ancestor marking the subtree sensitive propagates to all descendants
  const isSensitive = chain.some((prefs) => prefs.isSensitive);

  // Walk child-first (most specific) for identity override — child overrides parent
  let gitIdentityName: string | null = null;
  let gitIdentityEmail: string | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const prefs = chain[i];
    if (prefs.gitIdentityName && !gitIdentityName) {
      gitIdentityName = prefs.gitIdentityName;
    }
    if (prefs.gitIdentityEmail && !gitIdentityEmail) {
      gitIdentityEmail = prefs.gitIdentityEmail;
    }
    if (gitIdentityName && gitIdentityEmail) break;
  }

  if (!gitIdentityName && !gitIdentityEmail) {
    return { env: null, isSensitive, gitIdentityName: null, gitIdentityEmail: null };
  }

  const env: Record<string, string> = {};
  if (gitIdentityName) {
    env.GIT_AUTHOR_NAME = gitIdentityName;
    env.GIT_COMMITTER_NAME = gitIdentityName;
  }
  if (gitIdentityEmail) {
    env.GIT_AUTHOR_EMAIL = gitIdentityEmail;
    env.GIT_COMMITTER_EMAIL = gitIdentityEmail;
  }

  return { env, isSensitive, gitIdentityName, gitIdentityEmail };
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
    xtermScrollback: db.xtermScrollback,
    tmuxHistoryLimit: db.tmuxHistoryLimit,
    theme: db.theme,
    fontSize: db.fontSize,
    fontFamily: db.fontFamily,
    activeNodeId: db.activeNodeId,
    activeNodeType: (db.activeNodeType as "group" | "project" | null) ?? null,
    pinnedNodeId: db.pinnedNodeId,
    pinnedNodeType: (db.pinnedNodeType as "group" | "project" | null) ?? null,
    autoFollowActiveSession: db.autoFollowActiveSession ?? true,
    notificationsEnabled: db.notificationsEnabled ?? true,
    beadsSidebarCollapsed: db.beadsSidebarCollapsed ?? true,
    beadsSidebarWidth: db.beadsSidebarWidth ?? 320,
    beadsClosedRetentionDays: db.beadsClosedRetentionDays ?? 7,
    beadsSectionExpanded: safeJsonParse<BeadsSectionExpandDefaults>(
      db.beadsSectionExpanded,
      BEADS_SECTION_EXPAND_DEFAULTS
    ),
    createdAt: new Date(db.createdAt),
    updatedAt: new Date(db.updatedAt),
  };
}

function mapDbFolderPreferences(
  dbRow: typeof nodePreferences.$inferSelect
): FolderPreferences {
  return {
    id: dbRow.id,
    folderId: dbRow.ownerId,
    userId: dbRow.userId,
    defaultWorkingDirectory: dbRow.defaultWorkingDirectory,
    defaultShell: dbRow.defaultShell,
    startupCommand: dbRow.startupCommand,
    theme: dbRow.theme,
    fontSize: dbRow.fontSize,
    fontFamily: dbRow.fontFamily,
    githubRepoId: dbRow.githubRepoId,
    localRepoPath: dbRow.localRepoPath,
    defaultAgentProvider: (dbRow.defaultAgentProvider as import("@/types/session").AgentProviderType | null) ?? null,
    environmentVars: parseEnvironmentVars(typeof dbRow.environmentVars === "string" ? dbRow.environmentVars : dbRow.environmentVars == null ? null : JSON.stringify(dbRow.environmentVars)),
    pinnedFiles: parsePinnedFiles(typeof dbRow.pinnedFiles === "string" ? dbRow.pinnedFiles : dbRow.pinnedFiles == null ? null : JSON.stringify(dbRow.pinnedFiles)),
    gitIdentityName: dbRow.gitIdentityName ?? null,
    gitIdentityEmail: dbRow.gitIdentityEmail ?? null,
    isSensitive: dbRow.isSensitive ?? false,
    createdAt: new Date(dbRow.createdAt),
    updatedAt: new Date(dbRow.updatedAt),
  };
}
