/**
 * AgentProfileService - Manages AI agent profiles for isolated configurations
 *
 * Each profile has its own config directory (~/.remote-dev/profiles/{id}/) with:
 * - Agent-specific configs (.claude/, .codex/, .gemini/, .config/opencode/)
 * - Git identity (.gitconfig)
 * - SSH keys (.ssh/)
 * - Environment variables (.env)
 */

import { db } from "@/db";
import {
  agentProfiles,
  folderProfileLinks,
  profileGitIdentities,
  terminalSessions,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
  AgentProfile,
  CreateAgentProfileInput,
  UpdateAgentProfileInput,
  ProfileEnvironment,
  GitIdentity,
  AgentProvider,
} from "@/types/agent";

// Profile base directory
const PROFILES_BASE_DIR = join(homedir(), ".remote-dev", "profiles");

/**
 * Get all profiles for a user
 */
export async function getProfiles(userId: string): Promise<AgentProfile[]> {
  const profiles = await db.query.agentProfiles.findMany({
    where: eq(agentProfiles.userId, userId),
    orderBy: [asc(agentProfiles.name)],
  });

  return profiles.map(mapDbToProfile);
}

/**
 * Get a profile by ID
 */
export async function getProfile(
  profileId: string,
  userId: string
): Promise<AgentProfile | null> {
  const profile = await db.query.agentProfiles.findFirst({
    where: and(
      eq(agentProfiles.id, profileId),
      eq(agentProfiles.userId, userId)
    ),
  });

  return profile ? mapDbToProfile(profile) : null;
}

/**
 * Get the default profile for a user
 */
export async function getDefaultProfile(
  userId: string
): Promise<AgentProfile | null> {
  const profile = await db.query.agentProfiles.findFirst({
    where: and(
      eq(agentProfiles.userId, userId),
      eq(agentProfiles.isDefault, true)
    ),
  });

  return profile ? mapDbToProfile(profile) : null;
}

/**
 * Get the profile linked to a folder
 */
export async function getFolderProfile(
  folderId: string,
  userId: string
): Promise<AgentProfile | null> {
  const link = await db.query.folderProfileLinks.findFirst({
    where: eq(folderProfileLinks.folderId, folderId),
  });

  if (!link) return null;

  return getProfile(link.profileId, userId);
}

/**
 * Create a new agent profile
 */
export async function createProfile(
  userId: string,
  input: CreateAgentProfileInput
): Promise<AgentProfile> {
  // Generate profile ID
  const profileId = crypto.randomUUID();
  const configDir = join(PROFILES_BASE_DIR, profileId);

  // If setting as default, unset existing default
  if (input.isDefault) {
    await db
      .update(agentProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(agentProfiles.userId, userId), eq(agentProfiles.isDefault, true)));
  }

  // Create profile record
  const [profile] = await db
    .insert(agentProfiles)
    .values({
      id: profileId,
      userId,
      name: input.name,
      description: input.description ?? null,
      provider: input.provider,
      configDir,
      isDefault: input.isDefault ?? false,
    })
    .returning();

  // Initialize profile directory structure
  await initializeProfileDirectory(profileId, input.provider);

  return mapDbToProfile(profile);
}

/**
 * Update an agent profile
 */
export async function updateProfile(
  profileId: string,
  userId: string,
  input: UpdateAgentProfileInput
): Promise<AgentProfile | null> {
  // If setting as default, unset existing default
  if (input.isDefault) {
    await db
      .update(agentProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(agentProfiles.userId, userId),
          eq(agentProfiles.isDefault, true)
        )
      );
  }

  const [updated] = await db
    .update(agentProfiles)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.provider !== undefined && { provider: input.provider }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, userId))
    )
    .returning();

  return updated ? mapDbToProfile(updated) : null;
}

/**
 * Delete an agent profile
 */
export async function deleteProfile(
  profileId: string,
  userId: string
): Promise<boolean> {
  // Remove profile from any linked sessions
  await db
    .update(terminalSessions)
    .set({ profileId: null, updatedAt: new Date() })
    .where(eq(terminalSessions.profileId, profileId));

  // Delete the profile (folder links cascade automatically)
  const result = await db
    .delete(agentProfiles)
    .where(
      and(eq(agentProfiles.id, profileId), eq(agentProfiles.userId, userId))
    );

  return result.rowsAffected > 0;
}

/**
 * Link a folder to a profile
 */
export async function linkFolderToProfile(
  folderId: string,
  profileId: string
): Promise<void> {
  await db
    .insert(folderProfileLinks)
    .values({ folderId, profileId })
    .onConflictDoUpdate({
      target: folderProfileLinks.folderId,
      set: { profileId, createdAt: new Date() },
    });
}

/**
 * Unlink a folder from its profile
 */
export async function unlinkFolderFromProfile(folderId: string): Promise<void> {
  await db
    .delete(folderProfileLinks)
    .where(eq(folderProfileLinks.folderId, folderId));
}

/**
 * Get all folder-profile links for a user's folders
 */
export async function getFolderProfileLinks(
  userId: string
): Promise<Record<string, string>> {
  // Get all profiles for user to verify ownership
  const userProfiles = await db.query.agentProfiles.findMany({
    where: eq(agentProfiles.userId, userId),
    columns: { id: true },
  });
  const profileIds = new Set(userProfiles.map((p) => p.id));

  // Get all links
  const links = await db.query.folderProfileLinks.findMany();

  // Filter to only links for user's profiles
  const result: Record<string, string> = {};
  for (const link of links) {
    if (profileIds.has(link.profileId)) {
      result[link.folderId] = link.profileId;
    }
  }

  return result;
}

/**
 * Initialize a profile's directory structure
 */
export async function initializeProfileDirectory(
  profileId: string,
  provider: AgentProvider
): Promise<void> {
  const configDir = join(PROFILES_BASE_DIR, profileId);

  // Create base directories
  const dirs = [
    configDir,
    join(configDir, ".ssh"),
    join(configDir, ".config"),
  ];

  // Add provider-specific directories
  if (provider === "all" || provider === "claude") {
    dirs.push(join(configDir, ".claude"));
  }
  if (provider === "all" || provider === "codex") {
    dirs.push(join(configDir, ".codex"));
  }
  if (provider === "all" || provider === "gemini") {
    dirs.push(join(configDir, ".gemini"));
  }
  if (provider === "all" || provider === "opencode") {
    dirs.push(join(configDir, ".config", "opencode"));
  }

  // Create directories
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Create default .gitconfig
  const gitConfig = `[user]
\tname =
\temail =
`;
  await writeFile(join(configDir, ".gitconfig"), gitConfig);

  // Create default CLAUDE.md if Claude provider
  if (provider === "all" || provider === "claude") {
    const claudeMd = `# CLAUDE.md

This is the global configuration file for Claude Code in this profile.

## Project Guidelines

Add your project-specific instructions here.
`;
    await writeFile(join(configDir, ".claude", "CLAUDE.md"), claudeMd);
  }

  // Create default AGENTS.md if Codex provider
  if (provider === "all" || provider === "codex") {
    const agentsMd = `# AGENTS.md

This is the global configuration file for OpenAI Codex in this profile.

## Project Guidelines

Add your project-specific instructions here.
`;
    await writeFile(join(configDir, ".codex", "AGENTS.md"), agentsMd);
  }

  // Create default GEMINI.md if Gemini provider
  if (provider === "all" || provider === "gemini") {
    const geminiMd = `# GEMINI.md

This is the global configuration file for Gemini CLI in this profile.

## Project Guidelines

Add your project-specific instructions here.
`;
    await writeFile(join(configDir, ".gemini", "GEMINI.md"), geminiMd);
  }
}

/**
 * Generate environment overlay for a profile
 */
export async function getProfileEnvironment(
  profileId: string,
  userId: string
): Promise<ProfileEnvironment | null> {
  const profile = await getProfile(profileId, userId);
  if (!profile) return null;

  const configDir = profile.configDir;

  // Build environment overlay
  const env: ProfileEnvironment = {
    HOME: configDir,
    XDG_CONFIG_HOME: join(configDir, ".config"),
    XDG_DATA_HOME: join(configDir, ".local", "share"),
  };

  // Add provider-specific environment variables
  if (profile.provider === "all" || profile.provider === "claude") {
    env.CLAUDE_CONFIG_DIR = join(configDir, ".claude");
  }
  if (profile.provider === "all" || profile.provider === "codex") {
    env.CODEX_HOME = join(configDir, ".codex");
  }
  if (profile.provider === "all" || profile.provider === "gemini") {
    env.GEMINI_HOME = join(configDir, ".gemini");
  }

  // Git configuration
  env.GIT_CONFIG = join(configDir, ".gitconfig");

  // SSH key if configured
  const gitIdentity = await getProfileGitIdentity(profileId);
  if (gitIdentity?.sshKeyPath) {
    env.GIT_SSH_COMMAND = `ssh -i ${gitIdentity.sshKeyPath} -o IdentitiesOnly=yes`;
  }

  return env;
}

/**
 * Get Git identity for a profile
 */
export async function getProfileGitIdentity(
  profileId: string
): Promise<GitIdentity | null> {
  const identity = await db.query.profileGitIdentities.findFirst({
    where: eq(profileGitIdentities.profileId, profileId),
  });

  if (!identity) return null;

  return {
    userName: identity.userName,
    userEmail: identity.userEmail,
    sshKeyPath: identity.sshKeyPath ?? undefined,
    gpgKeyId: identity.gpgKeyId ?? undefined,
    githubUsername: identity.githubUsername ?? undefined,
  };
}

/**
 * Set Git identity for a profile
 */
export async function setProfileGitIdentity(
  profileId: string,
  identity: GitIdentity
): Promise<void> {
  // Update git identity record
  await db
    .insert(profileGitIdentities)
    .values({
      profileId,
      userName: identity.userName,
      userEmail: identity.userEmail,
      sshKeyPath: identity.sshKeyPath ?? null,
      gpgKeyId: identity.gpgKeyId ?? null,
      githubUsername: identity.githubUsername ?? null,
    })
    .onConflictDoUpdate({
      target: profileGitIdentities.profileId,
      set: {
        userName: identity.userName,
        userEmail: identity.userEmail,
        sshKeyPath: identity.sshKeyPath ?? null,
        gpgKeyId: identity.gpgKeyId ?? null,
        githubUsername: identity.githubUsername ?? null,
        updatedAt: new Date(),
      },
    });

  // Update .gitconfig file in profile directory
  const profile = await db.query.agentProfiles.findFirst({
    where: eq(agentProfiles.id, profileId),
  });

  if (profile) {
    const gitConfig = `[user]
\tname = ${identity.userName}
\temail = ${identity.userEmail}
${identity.gpgKeyId ? `\tsigningkey = ${identity.gpgKeyId}` : ""}
${identity.gpgKeyId ? "[commit]\n\tgpgsign = true" : ""}
`;
    await writeFile(join(profile.configDir, ".gitconfig"), gitConfig);
  }
}

/**
 * Check if a profile directory exists and is accessible
 */
export async function isProfileDirectoryAccessible(
  profileId: string
): Promise<boolean> {
  const profile = await db.query.agentProfiles.findFirst({
    where: eq(agentProfiles.id, profileId),
  });

  if (!profile) return false;

  try {
    await access(profile.configDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Map database record to AgentProfile type
 */
function mapDbToProfile(record: typeof agentProfiles.$inferSelect): AgentProfile {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    description: record.description ?? undefined,
    provider: record.provider as AgentProvider,
    configDir: record.configDir,
    isDefault: record.isDefault,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

// Export error class for service-specific errors
export class AgentProfileServiceError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "AgentProfileServiceError";
  }
}
