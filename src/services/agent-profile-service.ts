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
import { mkdir, writeFile, readFile, access } from "fs/promises";
import { join, dirname, resolve as pathResolve, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { createSecretsProvider, isProviderSupported } from "./secrets";
import { encrypt, decryptSafe } from "@/lib/encryption";
import { AgentProfileServiceError } from "@/lib/errors";
import { execFile, execFileNoThrow } from "@/lib/exec";
import { safeJsonParse } from "@/lib/utils";
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
  userId: string,
  existingProfile?: AgentProfile
): Promise<ProfileEnvironment | null> {
  const profile = existingProfile ?? await getProfile(profileId, userId);
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
// Startup Command HOME Resolution
// ============================================================================

/** Only allow safe alias names: alphanumeric, hyphens, underscores */
const SAFE_ALIAS_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Resolve the effective HOME directory from a startup command.
 *
 * Handles two patterns:
 * 1. Inline `HOME=/path cmd ...` — extracts /path directly
 * 2. Shell aliases (e.g. `jclaude`) — resolves via the user's shell
 *    and extracts HOME= from the alias definition
 *
 * Returns the HOME path if a HOME override is detected, null otherwise.
 */
export async function resolveEffectiveHome(
  startupCommand: string
): Promise<string | null> {
  const trimmed = startupCommand.trim();

  // Pattern 1: Inline HOME=/path at the start of the command
  // Matches: HOME=/Users/foo claude ... or HOME="/Users/foo" claude ...
  const inlineMatch = trimmed.match(/^HOME=["']?([^\s"']+)["']?\s/);
  if (inlineMatch) {
    return inlineMatch[1];
  }

  // Pattern 2: Single-word command that could be a shell alias
  const firstWord = trimmed.split(/\s/)[0];
  if (!firstWord || !SAFE_ALIAS_NAME.test(firstWord)) {
    return null;
  }

  try {
    // Use user's login shell (fall back to zsh) with -ic to load aliases
    const shell = process.env.SHELL || "zsh";
    const result = await execFileNoThrow(
      shell,
      ["-ic", `type ${firstWord}`],
      { timeout: 3000 }
    );

    if (result.exitCode !== 0 || !result.stdout) {
      return null;
    }

    // Shell output: "jclaude is an alias for HOME=/Users/joyfulhouse claude ..."
    const aliasMatch = result.stdout.match(/HOME=["']?([^\s"']+)["']?/);
    if (aliasMatch) {
      return aliasMatch[1];
    }
  } catch {
    // Alias resolution failed — not critical
  }

  return null;
}

// ============================================================================
// Agent Hooks Installation
// ============================================================================

/** Marker substrings used to identify RDV hooks (for deduplication) */
const ACTIVITY_HOOK_MARKER = "/internal/agent-status";
const TODO_HOOK_MARKER = "/internal/agent-todos";

/** Check if a hook entry contains the given marker substring */
function isRdvHook(entry: unknown, marker: string): boolean {
  return typeof entry === "object" && entry !== null &&
    JSON.stringify(entry).includes(marker);
}

/** Filter out RDV hooks matching the given marker (preserves user hooks) */
function withoutRdvHooks(arr: unknown[], marker: string): unknown[] {
  return arr.filter((entry) => !isRdvHook(entry, marker));
}

/**
 * Install hooks into the agent's settings file.
 * Currently supports Claude Code only (hooks in .claude/settings.json).
 *
 * Supports both socket mode (RDV_TERMINAL_SOCKET) and port mode (RDV_TERMINAL_PORT).
 * These env vars plus RDV_SESSION_ID are set as tmux env vars per session.
 *
 * Activity-reporting hooks (→ /internal/agent-status):
 * - PreToolUse → status "running" (agent is executing a tool)
 * - PreCompact → status "compacting" (context window compaction in progress)
 * - Notification (permission/elicitation) → status "waiting" (needs user input)
 * - Stop → status "idle" (agent finished its turn)
 *
 * Task sync hooks (→ /internal/agent-todos):
 * - PostToolUse (matcher: "TaskCreate|TaskUpdate|TodoWrite") → syncs tasks to project_task table
 */
export async function installAgentHooks(
  configDir: string,
  provider: AgentProvider
): Promise<void> {
  // Only Claude Code supports hooks currently
  if (provider !== "claude") return;

  const settingsPath = join(configDir, ".claude", "settings.json");

  // Read existing settings (if any) to merge hooks
  let existingSettings: Record<string, unknown> = {};
  let rawContent = "";
  try {
    rawContent = await readFile(settingsPath, "utf-8");
    existingSettings = JSON.parse(rawContent);
  } catch {
    // File doesn't exist or is invalid JSON - start fresh
  }

  // Activity status hooks read RDV vars from tmux session-level environment
  // at runtime. Uses a single `tmux show-environment` dump (parsed via eval)
  // to resolve session ID and connection info. This is more robust than relying
  // on inherited process env because the tmux server doesn't propagate the
  // client's env to spawned shells.
  const envPreamble =
    '_RDV_SN=$(tmux display-message -p "#{session_name}" 2>/dev/null); ' +
    '[ -z "$_RDV_SN" ] && exit 0; ' +
    'eval "$(tmux show-environment -t "$_RDV_SN" 2>/dev/null | grep "^RDV_")" 2>/dev/null; ' +
    '[ -z "$RDV_SESSION_ID" ] && exit 0; ';

  /** Build a curl command that hits an internal endpoint via socket or port */
  const curlCmd = (path: string, opts = "") =>
    'if [ -n "$RDV_TERMINAL_SOCKET" ]; then ' +
    `curl --unix-socket "$RDV_TERMINAL_SOCKET" -s -X POST "http://localhost${path}" ${opts}; ` +
    'else ' +
    `curl -s -X POST "http://localhost:\${RDV_TERMINAL_PORT}${path}" ${opts}; ` +
    'fi';

  const curlForStatus = (status: string) =>
    envPreamble + curlCmd(`/internal/agent-status?sessionId=\${RDV_SESSION_ID}&status=${status}`) + ' || true';

  const preToolUseHook = {
    matcher: "",
    hooks: [{ type: "command", command: curlForStatus("running"), timeout: 5 }],
  };

  const preCompactHook = {
    matcher: "",
    hooks: [{ type: "command", command: curlForStatus("compacting"), timeout: 5 }],
  };

  const notificationHook = {
    matcher: "permission_prompt|elicitation_dialog",
    hooks: [{ type: "command", command: curlForStatus("waiting"), timeout: 5 }],
  };

  // Stop hook: report idle status (fire-and-forget, backgrounded) AND check
  // if all tasks are completed. Non-empty output tells Claude Code to continue.
  const stopCheckCommand = envPreamble +
    curlCmd('/internal/agent-status?sessionId=${RDV_SESSION_ID}&status=idle', '>/dev/null 2>&1') + ' & ' +
    'TASK_MSG=$(' + curlCmd('/internal/agent-stop-check?sessionId=${RDV_SESSION_ID}') + '); ' +
    '[ -n "$TASK_MSG" ] && printf "%s" "$TASK_MSG"';

  const stopHook = {
    hooks: [{ type: "command", command: stopCheckCommand, timeout: 15 }],
  };

  // Task sync hook: reads PostToolUse JSON from stdin, POSTs to /internal/agent-todos
  // Matches TaskCreate, TaskUpdate (v2.1.69+), and legacy TodoWrite
  const todoSyncCommand =
    'INPUT=$(cat); ' + envPreamble +
    'if [ -n "$RDV_TERMINAL_SOCKET" ]; then ' +
    'printf \'%s\' "$INPUT" | curl --unix-socket "$RDV_TERMINAL_SOCKET" -s -X POST -H "Content-Type: application/json" -d @- "http://localhost/internal/agent-todos?sessionId=${RDV_SESSION_ID}"; ' +
    'else ' +
    'printf \'%s\' "$INPUT" | curl -s -X POST -H "Content-Type: application/json" -d @- "http://localhost:${RDV_TERMINAL_PORT}/internal/agent-todos?sessionId=${RDV_SESSION_ID}"; ' +
    'fi || true';

  const postToolUseTodoHook = {
    matcher: "TaskCreate|TaskUpdate|TodoWrite",
    hooks: [{ type: "command", command: todoSyncCommand, timeout: 10 }],
  };

  // Merge with existing hooks — replace any old RDV hooks with current version,
  // preserving user-defined hooks. This handles upgrades (e.g., port-only → socket-aware).
  const existingHooks = (existingSettings.hooks ?? {}) as Record<string, unknown[]>;

  const existingPreToolUse = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : [];
  const existingPreCompact = Array.isArray(existingHooks.PreCompact) ? existingHooks.PreCompact : [];
  const existingNotification = Array.isArray(existingHooks.Notification) ? existingHooks.Notification : [];
  const existingStop = Array.isArray(existingHooks.Stop) ? existingHooks.Stop : [];
  const existingPostToolUse = Array.isArray(existingHooks.PostToolUse) ? existingHooks.PostToolUse : [];

  // Clean up legacy SessionStart RDV hooks from older installations
  const existingSessionStart = Array.isArray(existingHooks.SessionStart) ? existingHooks.SessionStart : [];
  const cleanedSessionStart = withoutRdvHooks(existingSessionStart, ACTIVITY_HOOK_MARKER);

  // Strip old RDV hooks (if any) and append current version
  const mergedHooks = {
    ...existingHooks,
    PreToolUse: [...withoutRdvHooks(existingPreToolUse, ACTIVITY_HOOK_MARKER), preToolUseHook],
    PreCompact: [...withoutRdvHooks(existingPreCompact, ACTIVITY_HOOK_MARKER), preCompactHook],
    PostToolUse: [...withoutRdvHooks(existingPostToolUse, TODO_HOOK_MARKER), postToolUseTodoHook],
    Notification: [...withoutRdvHooks(existingNotification, ACTIVITY_HOOK_MARKER), notificationHook],
    Stop: [...withoutRdvHooks(existingStop, ACTIVITY_HOOK_MARKER), stopHook],
    // Remove legacy SessionStart RDV hooks (replaced by PreToolUse)
    ...(cleanedSessionStart.length > 0 ? { SessionStart: cleanedSessionStart } : { SessionStart: undefined }),
  };

  // Remove empty hook arrays to keep settings clean
  if (mergedHooks.SessionStart === undefined || (Array.isArray(mergedHooks.SessionStart) && mergedHooks.SessionStart.length === 0)) {
    delete mergedHooks.SessionStart;
  }

  const updatedSettings = {
    ...existingSettings,
    hooks: mergedHooks,
  };

  // Skip write if settings are unchanged (hooks already current)
  const newContent = JSON.stringify(updatedSettings, null, 2) + "\n";
  if (newContent === rawContent) return;

  // Ensure .claude directory exists
  await mkdir(join(configDir, ".claude"), { recursive: true });
  await writeFile(settingsPath, newContent);
}

// ============================================================================
// MCP Server Registration
// ============================================================================

/** Resolve the RDV project root from this module's location (src/services/ → ../..) */
const RDV_PROJECT_ROOT = pathResolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** MCP server name used across all agent configs */
const MCP_SERVER_NAME = "remote-dev";

/**
 * Register the Remote Dev MCP server in the agent's config file.
 * Idempotent: reads existing config, merges only the `remote-dev` entry,
 * and skips the write if nothing changed.
 *
 * Uses `sh -c "cd <project> && exec node_modules/.bin/tsx ..."` instead of
 * `bun run mcp` because bun run does not relay stdin to subprocesses,
 * which breaks the MCP stdio protocol handshake.
 */
export async function registerMCPServer(
  configDir: string,
  provider: AgentProvider,
  userId: string
): Promise<void> {
  const mcpEntry = createMCPEntry(userId);

  const handlers: Record<string, (dir: string, entry: MCPEntry) => Promise<void>> = {
    claude: (dir, entry) => registerMCPForJsonSettings(dir, ".claude", entry),
    gemini: (dir, entry) => registerMCPForJsonSettings(dir, ".gemini", entry),
    codex: registerMCPForCodex,
  };

  const providers = provider === "all"
    ? Object.keys(handlers)
    : handlers[provider] ? [provider] : [];

  await Promise.all(providers.map((p) => handlers[p](configDir, mcpEntry)));
}

/**
 * Register the Remote Dev MCP server in a project's .mcp.json file.
 * This is the primary discovery path for Claude Code project-scoped MCP servers.
 * Idempotent: merges the remote-dev entry, preserving other servers.
 */
export async function registerMCPInProjectDir(
  projectDir: string,
  userId: string
): Promise<void> {
  await writeMCPEntryToJson(join(projectDir, ".mcp.json"), createMCPEntry(userId));
}

interface MCPEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Register MCP server in a JSON settings file (used by Claude and Gemini).
 * Both use the same format: { mcpServers: { "remote-dev": { ... } } }
 */
async function registerMCPForJsonSettings(
  configDir: string,
  subDir: string,
  entry: MCPEntry
): Promise<void> {
  const settingsPath = join(configDir, subDir, "settings.json");
  await mkdir(join(configDir, subDir), { recursive: true });
  await writeMCPEntryToJson(settingsPath, entry);
}

/**
 * Register MCP server in Codex's .codex/config.toml
 */
async function registerMCPForCodex(
  configDir: string,
  entry: MCPEntry
): Promise<void> {
  const configPath = join(configDir, ".codex", "config.toml");

  let rawContent = "";
  try {
    rawContent = await readFile(configPath, "utf-8");
  } catch {
    // File doesn't exist - start fresh
  }

  // Build the TOML section for the MCP server
  const argsToml = entry.args.map((a) => `"${a}"`).join(", ");
  const envEntries = Object.entries(entry.env)
    .map(([k, v]) => `${k} = "${v}"`)
    .join(", ");
  const section =
    `[mcp_servers.${MCP_SERVER_NAME}]\n` +
    `command = "${entry.command}"\n` +
    `args = [${argsToml}]\n` +
    `env = { ${envEntries} }\n`;

  // Check if section already exists and replace it, or append
  const sectionRegex = new RegExp(
    `\\[mcp_servers\\.${MCP_SERVER_NAME}\\][\\s\\S]*?(?=\\n\\[|$)`
  );

  let newContent: string;
  if (sectionRegex.test(rawContent)) {
    newContent = rawContent.replace(sectionRegex, section);
  } else {
    newContent = rawContent
      ? `${rawContent.trimEnd()}\n\n${section}`
      : section;
  }

  if (newContent === rawContent) return;

  await mkdir(join(configDir, ".codex"), { recursive: true });
  await writeFile(configPath, newContent);
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
    providerConfig: safeJsonParse(decryptedConfig ?? "{}", {} as Record<string, string>),
    enabled: dbRecord.enabled ?? true,
    lastFetchedAt: dbRecord.lastFetchedAt ? new Date(dbRecord.lastFetchedAt) : null,
    createdAt: new Date(dbRecord.createdAt),
    updatedAt: new Date(dbRecord.updatedAt),
  };
}

// ============================================================================
// MCP Registration Self-Check (Startup)
// ============================================================================

/** Expected shell command fragment inside .mcp.json args */
const EXPECTED_MCP_ARGS_PATTERN = `cd ${RDV_PROJECT_ROOT} && exec node_modules/.bin/tsx src/mcp/standalone.ts`;

/** Build a standard MCP entry for the remote-dev server. */
function createMCPEntry(userId: string): MCPEntry {
  return {
    command: "sh",
    args: ["-c", `cd ${RDV_PROJECT_ROOT} && exec node_modules/.bin/tsx src/mcp/standalone.ts`],
    env: { MCP_USER_ID: userId },
  };
}

/**
 * Write an MCP entry into a JSON config file at the given path.
 * Creates or merges the `mcpServers` object, preserving other entries.
 * Skips the write if the content would be unchanged.
 */
async function writeMCPEntryToJson(
  filePath: string,
  entry: MCPEntry
): Promise<void> {
  let config: Record<string, unknown> = {};
  let rawContent = "";
  try {
    rawContent = await readFile(filePath, "utf-8");
    config = JSON.parse(rawContent);
  } catch {
    // File doesn't exist or invalid JSON - start fresh
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers[MCP_SERVER_NAME] = entry;
  config.mcpServers = mcpServers;

  const newContent = JSON.stringify(config, null, 2) + "\n";
  if (newContent === rawContent) return;

  await writeFile(filePath, newContent);
}

/**
 * Validate an MCP entry for the `remote-dev` server.
 * Returns `{ valid: true }` if the entry matches the expected format,
 * or `{ valid: false, reason }` describing what's wrong.
 */
function validateMCPEntry(
  entry: unknown
): { valid: true } | { valid: false; reason: string } {
  if (typeof entry !== "object" || entry === null) {
    return { valid: false, reason: "entry is not an object" };
  }

  const e = entry as Record<string, unknown>;

  if (e.command !== "sh") {
    return { valid: false, reason: `command is "${e.command}" (expected "sh")` };
  }

  if (!Array.isArray(e.args) || e.args.length < 2) {
    return { valid: false, reason: "args missing or too short" };
  }

  const shArg = e.args[1] as string;
  if (typeof shArg !== "string" || !shArg.includes(EXPECTED_MCP_ARGS_PATTERN)) {
    return { valid: false, reason: `was: ${shArg}` };
  }

  return { valid: true };
}

/**
 * Check a JSON config file for a stale `remote-dev` MCP entry and repair it.
 * Skips silently if the file doesn't exist or has no `remote-dev` entry.
 *
 * Works for both `.mcp.json` and `settings.json` files since they share
 * the same `{ mcpServers: { "remote-dev": { ... } } }` structure.
 */
async function checkAndRepairMCPConfig(
  filePath: string,
  repair: () => Promise<void>
): Promise<void> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !servers[MCP_SERVER_NAME]) return;

    const result = validateMCPEntry(servers[MCP_SERVER_NAME]);
    if (result.valid) {
      console.warn(`[MCP] Config OK: ${filePath}`);
      return;
    }

    console.warn(`[MCP] Repaired stale config: ${filePath} (${result.reason})`);
    await repair();
  } catch {
    // File doesn't exist or isn't valid JSON - skip silently
  }
}

/**
 * Scan known config locations for MCP config files containing a `remote-dev`
 * entry, validate them, and auto-repair stale configs.
 *
 * Runs on terminal server startup. Non-blocking: errors are logged but never
 * prevent the server from starting.
 *
 * Locations checked:
 * 1. Project root `.mcp.json`
 * 2. Parent directories up to home: `.mcp.json` and `.claude/.mcp.json`
 * 3. Home-level Claude settings `~/.claude/settings.json`
 */
export async function ensureMCPRegistration(): Promise<void> {
  const userId = process.env.MCP_USER_ID || "mcp-local-user";
  const home = homedir();
  const entry = createMCPEntry(userId);

  // Check tsx binary exists
  const tsxPath = join(RDV_PROJECT_ROOT, "node_modules", ".bin", "tsx");
  try {
    await access(tsxPath);
  } catch {
    console.warn(`[MCP] Warning: tsx binary not found at ${tsxPath}`);
  }

  // Collect all config file paths to check, paired with their repair functions
  const configs: Array<{ path: string; repair: () => Promise<void> }> = [];

  // 1. Project root .mcp.json
  configs.push({
    path: join(RDV_PROJECT_ROOT, ".mcp.json"),
    repair: () => registerMCPInProjectDir(RDV_PROJECT_ROOT, userId),
  });

  // 2. Walk parent directories up to home
  let dir = dirname(RDV_PROJECT_ROOT);
  while (dir.length >= home.length && dir !== dirname(dir)) {
    const currentDir = dir;
    configs.push({
      path: join(currentDir, ".mcp.json"),
      repair: () => registerMCPInProjectDir(currentDir, userId),
    });
    configs.push({
      path: join(currentDir, ".claude", ".mcp.json"),
      repair: () => writeMCPEntryToJson(join(currentDir, ".claude", ".mcp.json"), entry),
    });
    dir = dirname(dir);
  }

  // 3. Home-level Claude settings
  const claudeSettingsPath = join(home, ".claude", "settings.json");
  configs.push({
    path: claudeSettingsPath,
    repair: () => writeMCPEntryToJson(claudeSettingsPath, entry),
  });

  // Check and repair each config sequentially (file I/O order matters for parent dirs)
  for (const { path, repair } of configs) {
    await checkAndRepairMCPConfig(path, repair);
  }
}

// Re-export error class from centralized location for backwards compatibility
export { AgentProfileServiceError } from "@/lib/errors";
