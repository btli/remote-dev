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
  profileSecretsConfig,
  terminalSessions,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { mkdir, writeFile, access } from "fs/promises";
import { join, resolve as pathResolve, isAbsolute } from "path";
import { homedir } from "os";
import { createSecretsProvider, isProviderSupported } from "./secrets";
import { encrypt, decryptSafe } from "@/lib/encryption";
import { AgentProfileServiceError } from "@/lib/errors";
import { getProfilesDir } from "@/lib/paths";
import { ProfileIsolation } from "@/domain/value-objects/ProfileIsolation";
import type {
  AgentProfile,
  CreateAgentProfileInput,
  UpdateAgentProfileInput,
  ProfileEnvironment,
  GitIdentity,
  AgentProvider,
  ProfileSecretsConfig,
  ProfileSecretsProviderType,
  UpdateProfileSecretsConfigInput,
} from "@/types/agent";

// Profile base directory - use centralized path configuration
const getProfilesBaseDir = () => getProfilesDir();

/**
 * Sanitize a git config value to prevent injection attacks.
 * Git config values can contain newlines and special characters that
 * could inject additional config sections.
 */
function sanitizeGitConfigValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\t/g, "\\t") // Escape tabs
    .replace(/"/g, '\\"'); // Escape quotes
}

/**
 * Validate an SSH key path to prevent command injection.
 * Returns the validated path or throws an error.
 */
function validateSshKeyPath(keyPath: string): string {
  // Must be absolute path
  if (!isAbsolute(keyPath)) {
    throw new Error("SSH key path must be an absolute path");
  }

  // Check for shell metacharacters that could enable injection
  const shellMetachars = /[;&|`$()[\]{}\\'"<>!#~*?\n\r]/;
  if (shellMetachars.test(keyPath)) {
    throw new Error("SSH key path contains invalid characters");
  }

  // Resolve to canonical path (prevents ../ traversal)
  const resolved = pathResolve(keyPath);

  // Must be within user's home directory or /tmp for safety
  const home = homedir();
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp/")) {
    throw new Error("SSH key path must be within home directory or /tmp");
  }

  return resolved;
}

/**
 * Safely parse JSON with fallback to empty object
 */
function safeJsonParse<T extends Record<string, unknown> = Record<string, string>>(
  json: string,
  fallback: T = {} as T
): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    console.error("Failed to parse JSON:", json.substring(0, 100));
    return fallback;
  }
}

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
  const configDir = join(getProfilesBaseDir(), profileId);

  // Use transaction to atomically unset existing default and create new profile
  // This prevents race conditions where multiple profiles could become default
  const profile = await db.transaction(async (tx) => {
    // If setting as default, unset existing default
    if (input.isDefault) {
      await tx
        .update(agentProfiles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(agentProfiles.userId, userId), eq(agentProfiles.isDefault, true)));
    }

    // Create profile record
    const [newProfile] = await tx
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

    return newProfile;
  });

  // Initialize profile directory structure (outside transaction - filesystem operation)
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
  // Use transaction to atomically unset existing default and update profile
  // This prevents race conditions where multiple profiles could become default
  const updated = await db.transaction(async (tx) => {
    // If setting as default, unset existing default
    if (input.isDefault) {
      await tx
        .update(agentProfiles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(agentProfiles.userId, userId),
            eq(agentProfiles.isDefault, true)
          )
        );
    }

    const [result] = await tx
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

    return result;
  });

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
): Promise<Array<{ folderId: string; profileId: string }>> {
  // Get all profiles for user to verify ownership
  const userProfiles = await db.query.agentProfiles.findMany({
    where: eq(agentProfiles.userId, userId),
    columns: { id: true },
  });
  const profileIds = new Set(userProfiles.map((p) => p.id));

  // Get all links
  const links = await db.query.folderProfileLinks.findMany();

  // Filter to only links for user's profiles and return as array
  return links
    .filter((link) => profileIds.has(link.profileId))
    .map((link) => ({ folderId: link.folderId, profileId: link.profileId }));
}

/**
 * Initialize a profile's directory structure
 */
export async function initializeProfileDirectory(
  profileId: string,
  provider: AgentProvider
): Promise<void> {
  const configDir = join(getProfilesBaseDir(), profileId);

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

  // Create default OPENCODE.md if OpenCode provider
  if (provider === "all" || provider === "opencode") {
    const opencodeMd = `# OPENCODE.md

This is the global configuration file for OpenCode in this profile.

## Project Guidelines

Add your project-specific instructions here.

## Provider Configuration

OpenCode supports multiple AI providers. Configure your preferred provider in settings.
`;
    await writeFile(join(configDir, ".config", "opencode", "OPENCODE.md"), opencodeMd);
  }
}

/**
 * Generate environment overlay for a profile.
 *
 * Uses ProfileIsolation value object to generate XDG-compliant paths.
 * HOME is intentionally NOT overridden - this allows user's dotfiles
 * (.bashrc, .zshrc, etc.) to work normally while still achieving
 * profile isolation via XDG variables.
 */
export async function getProfileEnvironment(
  profileId: string,
  userId: string
): Promise<ProfileEnvironment | null> {
  const profile = await getProfile(profileId, userId);
  if (!profile) return null;

  const configDir = profile.configDir;

  // Get git identity for SSH key path
  const gitIdentity = await getProfileGitIdentity(profileId);

  // Use ProfileIsolation to generate environment with XDG paths
  // Note: HOME is NOT overridden - user's dotfiles work normally
  const isolation = ProfileIsolation.create({
    profileDir: configDir,
    realHome: homedir(),
    provider: profile.provider,
    sshKeyPath: gitIdentity?.sshKeyPath,
    gitIdentity: gitIdentity
      ? { name: gitIdentity.userName, email: gitIdentity.userEmail }
      : undefined,
  });

  // Convert TmuxEnvironment to ProfileEnvironment record
  const isolationEnv = isolation.toEnvironment();
  const env: ProfileEnvironment = {
    XDG_CONFIG_HOME: isolationEnv.get("XDG_CONFIG_HOME") ?? join(configDir, ".config"),
    XDG_DATA_HOME: isolationEnv.get("XDG_DATA_HOME") ?? join(configDir, ".local", "share"),
  };

  // Copy all other variables from isolation
  for (const [key, value] of isolationEnv) {
    if (key !== "XDG_CONFIG_HOME" && key !== "XDG_DATA_HOME") {
      env[key] = value;
    }
  }

  // Fetch and inject secrets from profile secrets config
  try {
    const secrets = await fetchProfileSecrets(profileId);
    if (secrets) {
      // Merge secrets into environment
      Object.assign(env, secrets);
    }
  } catch (error) {
    // Log but don't fail if secrets fetch fails
    console.error(`Failed to fetch secrets for profile ${profileId}:`, error);
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
    // Sanitize all values to prevent git config injection attacks
    const safeName = sanitizeGitConfigValue(identity.userName);
    const safeEmail = sanitizeGitConfigValue(identity.userEmail);
    const safeGpgKey = identity.gpgKeyId
      ? sanitizeGitConfigValue(identity.gpgKeyId)
      : null;

    const gitConfig = `[user]
\tname = ${safeName}
\temail = ${safeEmail}
${safeGpgKey ? `\tsigningkey = ${safeGpgKey}` : ""}
${safeGpgKey ? "[commit]\n\tgpgsign = true" : ""}
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

// ============================================================================
// Profile Secrets Management
// ============================================================================

/**
 * Get profile secrets configuration
 */
export async function getProfileSecretsConfig(
  profileId: string,
  userId: string
): Promise<ProfileSecretsConfig | null> {
  const config = await db.query.profileSecretsConfig.findFirst({
    where: and(
      eq(profileSecretsConfig.profileId, profileId),
      eq(profileSecretsConfig.userId, userId)
    ),
  });

  return config ? mapDbToSecretsConfig(config) : null;
}

/**
 * Create or update profile secrets configuration
 */
export async function updateProfileSecretsConfig(
  profileId: string,
  userId: string,
  input: UpdateProfileSecretsConfigInput
): Promise<ProfileSecretsConfig> {
  // Validate provider is supported
  if (!isProviderSupported(input.provider)) {
    throw new AgentProfileServiceError(
      `Provider '${input.provider}' is not yet supported`,
      "PROVIDER_NOT_SUPPORTED"
    );
  }

  // Validate provider config
  try {
    const provider = createSecretsProvider({
      provider: input.provider,
      config: input.config,
    });
    const validation = await provider.validate();
    if (!validation.valid) {
      throw new AgentProfileServiceError(
        validation.error || "Invalid provider configuration",
        "INVALID_CONFIG"
      );
    }
  } catch (error) {
    if (error instanceof AgentProfileServiceError) throw error;
    throw new AgentProfileServiceError(
      `Failed to validate provider config: ${(error as Error).message}`,
      "VALIDATION_FAILED"
    );
  }

  // Encrypt provider config before storage (contains service tokens)
  const configJson = JSON.stringify(input.config);
  const encryptedConfig = encrypt(configJson);
  const now = new Date();

  // Check for existing config
  const existing = await getProfileSecretsConfig(profileId, userId);

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(profileSecretsConfig)
      .set({
        provider: input.provider,
        providerConfig: encryptedConfig,
        enabled: input.enabled ?? true,
        updatedAt: now,
      })
      .where(
        and(
          eq(profileSecretsConfig.profileId, profileId),
          eq(profileSecretsConfig.userId, userId)
        )
      )
      .returning();

    return mapDbToSecretsConfig(updated);
  }

  // Create new
  const [created] = await db
    .insert(profileSecretsConfig)
    .values({
      profileId,
      userId,
      provider: input.provider,
      providerConfig: encryptedConfig,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbToSecretsConfig(created);
}

/**
 * Delete profile secrets configuration
 */
export async function deleteProfileSecretsConfig(
  profileId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(profileSecretsConfig)
    .where(
      and(
        eq(profileSecretsConfig.profileId, profileId),
        eq(profileSecretsConfig.userId, userId)
      )
    );

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Toggle enabled state for profile secrets
 */
export async function toggleProfileSecretsEnabled(
  profileId: string,
  userId: string,
  enabled: boolean
): Promise<ProfileSecretsConfig | null> {
  const existing = await getProfileSecretsConfig(profileId, userId);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(profileSecretsConfig)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(profileSecretsConfig.profileId, profileId),
        eq(profileSecretsConfig.userId, userId)
      )
    )
    .returning();

  return mapDbToSecretsConfig(updated);
}

/**
 * Fetch secrets for a profile from the configured provider
 * Returns null if no secrets config or disabled
 */
export async function fetchProfileSecrets(
  profileId: string
): Promise<Record<string, string> | null> {
  const config = await db.query.profileSecretsConfig.findFirst({
    where: and(
      eq(profileSecretsConfig.profileId, profileId),
      eq(profileSecretsConfig.enabled, true)
    ),
  });

  if (!config) {
    return null;
  }

  // Safely parse provider config with error handling
  let providerConfig: Record<string, string>;
  try {
    providerConfig = JSON.parse(config.providerConfig) as Record<string, string>;
  } catch (error) {
    console.error(
      `Failed to parse provider config for profile ${profileId}:`,
      error
    );
    return null;
  }

  const provider = createSecretsProvider({
    provider: config.provider as ProfileSecretsProviderType,
    config: providerConfig,
  });

  const secretsList = await provider.fetchSecrets();
  const fetchedAt = new Date();

  // Update last fetched timestamp
  await db
    .update(profileSecretsConfig)
    .set({ lastFetchedAt: fetchedAt })
    .where(eq(profileSecretsConfig.id, config.id));

  // Convert to environment variables object
  const secrets = secretsList.reduce(
    (acc, { key, value }) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<string, string>
  );

  return secrets;
}

/**
 * Map database record to ProfileSecretsConfig type.
 * Decrypts provider config (handles both encrypted and legacy plaintext).
 */
function mapDbToSecretsConfig(
  dbRecord: typeof profileSecretsConfig.$inferSelect
): ProfileSecretsConfig {
  // Decrypt provider config - handles both encrypted and legacy plaintext
  const decryptedConfig = decryptSafe(dbRecord.providerConfig);
  
  return {
    id: dbRecord.id,
    profileId: dbRecord.profileId,
    userId: dbRecord.userId,
    provider: dbRecord.provider as ProfileSecretsProviderType,
    providerConfig: safeJsonParse(decryptedConfig ?? "{}"),
    enabled: dbRecord.enabled ?? true,
    lastFetchedAt: dbRecord.lastFetchedAt ? new Date(dbRecord.lastFetchedAt) : null,
    createdAt: new Date(dbRecord.createdAt),
    updatedAt: new Date(dbRecord.updatedAt),
  };
}

// Re-export error class from centralized location for backwards compatibility
export { AgentProfileServiceError } from "@/lib/errors";
