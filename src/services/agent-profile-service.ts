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
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createSecretsProvider, isProviderSupported } from "./secrets";
import { encrypt, decryptSafe } from "@/lib/encryption";
import { AgentProfileServiceError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("AgentProfile");
import { execFileNoThrow } from "@/lib/exec";
import { safeJsonParse } from "@/lib/utils";
import { getProfilesDir } from "@/lib/paths";
import { ProfileIsolation } from "@/domain/value-objects/ProfileIsolation";
import { gitCredentialManager } from "@/infrastructure/container";
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
 * Resolve the git [credential] section for profile .gitconfig files.
 * Returns an empty string if the credential manager is unavailable.
 */
async function getCredentialSection(): Promise<string> {
  try {
    return await gitCredentialManager.getCredentialSection();
  } catch (error) {
    log.warn("Failed to get credential section for profile gitconfig", { error: String(error) });
    return "";
  }
}

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

  // Create default .gitconfig with credential helper to suppress macOS keychain prompts
  const credentialSection = await getCredentialSection();
  const gitConfig = `[user]
\tname =
\temail =
${credentialSection}`;
  await writeFile(join(configDir, ".gitconfig"), gitConfig);

  // Shared RDV quick-reference injected into all provider config files
  const rdvSection = `
## Remote Dev Environment

You are running inside a **Remote Dev** session. The \`rdv\` CLI is available for
interacting with sessions, tasks, peers, worktrees, and more.

**Start here:**
\`\`\`bash
rdv context          # Discover your session ID, folder, and project path
rdv task list        # Check assigned tasks
\`\`\`

**Environment variables** (set automatically):
- \`RDV_SESSION_ID\` -- Your session UUID
- \`RDV_TERMINAL_PORT\` -- Terminal server port
- \`RDV_API_PORT\` -- API server port
- \`RDV_API_KEY\` -- Bearer token for API auth

**Quick reference:**
| Command | Description |
|---------|-------------|
| \`rdv session list\` | List all sessions |
| \`rdv session exec <id> "cmd"\` | Run command in another session |
| \`rdv agent start <folder-id>\` | Start a parallel agent session |
| \`rdv agent stop <id>\` | Stop an agent session |
| \`rdv teams launch --count N\` | Launch N coordinated agents |
| \`rdv teams wait <parent-id>\` | Wait for child agents to finish |
| \`rdv worktree create --repo . --branch <name>\` | Create git worktree |
| \`rdv worktree cleanup\` | Clean up worktree, branches, and session |
| \`rdv task create "title"\` | Create a task |
| \`rdv task complete <id>\` | Mark task done |
| \`rdv peer list\` | List peer agents in same folder |
| \`rdv peer send "message"\` | Broadcast to peers |
| \`rdv send text <id> "text"\` | Send text to another session PTY |
| \`rdv screen <id> --human\` | View another session's screen |
| \`rdv notification list --unread\` | Check notifications |
| \`rdv status --human\` | System dashboard |

Run \`rdv --help\` or \`rdv <command> --help\` for full documentation.
`;

  // Create default CLAUDE.md if Claude provider
  if (provider === "all" || provider === "claude") {
    const claudeMd = `# CLAUDE.md

Global configuration for Claude Code in this profile.

## Project Guidelines

Add your project-specific instructions here.
${rdvSection}`;
    await writeFile(join(configDir, ".claude", "CLAUDE.md"), claudeMd);
  }

  // Create default AGENTS.md if Codex provider
  if (provider === "all" || provider === "codex") {
    const agentsMd = `# AGENTS.md

Global configuration for OpenAI Codex in this profile.

## Project Guidelines

Add your project-specific instructions here.
${rdvSection}`;
    await writeFile(join(configDir, ".codex", "AGENTS.md"), agentsMd);
  }

  // Create default GEMINI.md if Gemini provider
  if (provider === "all" || provider === "gemini") {
    const geminiMd = `# GEMINI.md

Global configuration for Gemini CLI in this profile.

## Project Guidelines

Add your project-specific instructions here.
${rdvSection}`;
    await writeFile(join(configDir, ".gemini", "GEMINI.md"), geminiMd);
  }

  // Create default OPENCODE.md if OpenCode provider
  if (provider === "all" || provider === "opencode") {
    const opencodeMd = `# OPENCODE.md

Global configuration for OpenCode in this profile.

## Project Guidelines

Add your project-specific instructions here.
${rdvSection}`;
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
    log.error("Failed to fetch secrets for profile", { profileId, error: String(error) });
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

    // Preserve credential helper section when rewriting gitconfig
    const credentialSection = await getCredentialSection();

    const gitConfig = `[user]
\tname = ${safeName}
\temail = ${safeEmail}
${safeGpgKey ? `\tsigningkey = ${safeGpgKey}` : ""}
${safeGpgKey ? "[commit]\n\tgpgsign = true" : ""}
${credentialSection}`;
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

/** Marker substrings used to identify RDV hooks (for deduplication).
 *  Uses the specific shell idiom from rdvOrCurlCommand() to avoid matching
 *  user-written hooks that happen to invoke rdv directly. */
const RDV_HOOK_MARKER = "if command -v rdv";
const RDV_HOOK_DIRECT_MARKER = "rdv hook ";
const LEGACY_ACTIVITY_HOOK_MARKER = "/internal/agent-status";
const LEGACY_TODO_HOOK_MARKER = "/internal/agent-todos";

/** Check if a hook entry is an RDV hook by inspecting its command field */
function isRdvHook(entry: unknown, marker: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  // Check top-level command field
  if (typeof obj.command === "string" && obj.command.includes(marker)) return true;
  // Check nested hooks array (the common structure)
  if (Array.isArray(obj.hooks)) {
    return obj.hooks.some(
      (h: unknown) =>
        typeof h === "object" && h !== null &&
        typeof (h as Record<string, unknown>).command === "string" &&
        ((h as Record<string, unknown>).command as string).includes(marker)
    );
  }
  return false;
}

/** Filter out RDV hooks matching any of the given markers (preserves user hooks) */
function withoutRdvHooks(arr: unknown[], markers: string[]): unknown[] {
  return arr.filter((entry) => !markers.some((m) => isRdvHook(entry, m)));
}

/**
 * Build a hook command that uses rdv CLI (preferred) with curl fallback.
 * The rdv CLI reads RDV_* env vars natively, so no tmux env preamble is needed.
 * Falls back to curl if rdv is not installed.
 */
function rdvOrCurlCommand(rdvCmd: string, curlFallback: string): string {
  return `if command -v rdv >/dev/null 2>&1; then ${rdvCmd}; else ${curlFallback}; fi`;
}

/** Env preamble for curl fallback (reads RDV vars from tmux) */
const CURL_ENV_PREAMBLE =
  '_RDV_SN=$(tmux display-message -p "#{session_name}" 2>/dev/null); ' +
  '[ -z "$_RDV_SN" ] && exit 0; ' +
  'eval "$(tmux show-environment -t "$_RDV_SN" 2>/dev/null | grep "^RDV_")" 2>/dev/null; ' +
  '[ -z "$RDV_SESSION_ID" ] && exit 0; ';

/** Build a curl command that hits an internal endpoint via socket or port.
 *  `prefix` is prepended before the if/else block (e.g. for piping stdin). */
function curlCmd(path: string, opts = "", prefix = ""): string {
  return prefix +
    'if [ -n "$RDV_TERMINAL_SOCKET" ]; then ' +
    `curl --unix-socket "$RDV_TERMINAL_SOCKET" -s -X POST "http://localhost${path}" ${opts}; ` +
    'else ' +
    `curl -s -X POST "http://localhost:\${RDV_TERMINAL_PORT}${path}" ${opts}; ` +
    'fi';
}

function curlForStatus(status: string): string {
  return CURL_ENV_PREAMBLE + curlCmd(`/internal/agent-status?sessionId=\${RDV_SESSION_ID}&status=${status}`) + ' || true';
}

/**
 * Install hooks into the agent's settings file.
 * Currently supports Claude Code only (hooks in .claude/settings.json).
 *
 * Uses rdv CLI when available, falls back to curl for environments
 * where the Rust binary isn't installed.
 *
 * Activity-reporting hooks:
 * - PreToolUse → status "running" (agent is executing a tool)
 * - PreCompact → status "compacting" (context window compaction in progress)
 * - Notification (permission/elicitation) → status "waiting" (needs user input)
 * - Stop → status "idle" + task completion check
 * - SessionEnd → status "ended" + optional learning analysis
 *
 * Task sync hooks:
 * - PostToolUse (matcher: "TaskCreate|TaskUpdate|TodoWrite") → syncs tasks to project_task table
 */
export async function installAgentHooks(
  configDir: string,
  provider: AgentProvider,
  rdvEnv?: Record<string, string>
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

  // Activity status hooks - rdv CLI preferred, curl fallback
  const preToolUseHook = {
    matcher: "",
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook pre-tool-use", curlForStatus("running")), timeout: 5 }],
  };

  const preCompactHook = {
    matcher: "",
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook pre-compact", curlForStatus("compacting")), timeout: 5 }],
  };

  const notificationHook = {
    matcher: "permission_prompt|elicitation_dialog",
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook notification", curlForStatus("waiting")), timeout: 5 }],
  };

  // Stop hook: report idle + check for incomplete tasks.
  // rdv task check handles both (reports idle and checks tasks in one call).
  const stopCurlFallback =
    CURL_ENV_PREAMBLE +
    curlCmd('/internal/agent-status?sessionId=${RDV_SESSION_ID}&status=idle', '>/dev/null 2>&1') + ' & ' +
    'TASK_MSG=$(' + curlCmd('/internal/agent-stop-check?sessionId=${RDV_SESSION_ID}', '-H "Accept: text/plain"') + '); ' +
    '[ -n "$TASK_MSG" ] && printf "%s" "$TASK_MSG"';

  const stopHook = {
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook stop", stopCurlFallback), timeout: 15 }],
  };

  // SessionEnd hook: report "ended" status + optional learning analysis
  const sessionEndHook = {
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook session-end", curlForStatus("ended")), timeout: 10 }],
  };

  // Task sync hook: reads PostToolUse JSON from stdin
  const todoCurlFallback =
    'INPUT=$(cat); ' + CURL_ENV_PREAMBLE +
    curlCmd(
      '/internal/agent-todos?sessionId=${RDV_SESSION_ID}',
      '-H "Content-Type: application/json" -d @-',
      'printf \'%s\' "$INPUT" | '
    ) + ' || true';

  const postToolUseTodoHook = {
    matcher: "TaskCreate|TaskUpdate|TodoWrite",
    hooks: [{ type: "command", command: rdvOrCurlCommand("rdv hook post-tool-use", todoCurlFallback), timeout: 10 }],
  };

  // Merge with existing hooks — replace any old RDV hooks (both rdv CLI and legacy curl)
  // with current version, preserving user-defined hooks.
  const existingHooks = (existingSettings.hooks ?? {}) as Record<string, unknown[]>;
  const hookMarkers = [RDV_HOOK_MARKER, RDV_HOOK_DIRECT_MARKER, LEGACY_ACTIVITY_HOOK_MARKER, LEGACY_TODO_HOOK_MARKER];

  const existingPreToolUse = Array.isArray(existingHooks.PreToolUse) ? existingHooks.PreToolUse : [];
  const existingPreCompact = Array.isArray(existingHooks.PreCompact) ? existingHooks.PreCompact : [];
  const existingNotification = Array.isArray(existingHooks.Notification) ? existingHooks.Notification : [];
  const existingStop = Array.isArray(existingHooks.Stop) ? existingHooks.Stop : [];
  const existingPostToolUse = Array.isArray(existingHooks.PostToolUse) ? existingHooks.PostToolUse : [];
  const existingSessionEnd = Array.isArray(existingHooks.SessionEnd) ? existingHooks.SessionEnd : [];

  // Clean up legacy SessionStart RDV hooks from older installations
  const existingSessionStart = Array.isArray(existingHooks.SessionStart) ? existingHooks.SessionStart : [];
  const cleanedSessionStart = withoutRdvHooks(existingSessionStart, hookMarkers);

  // Strip old RDV hooks (if any) and append current version
  const mergedHooks = {
    ...existingHooks,
    PreToolUse: [...withoutRdvHooks(existingPreToolUse, hookMarkers), preToolUseHook],
    PreCompact: [...withoutRdvHooks(existingPreCompact, hookMarkers), preCompactHook],
    PostToolUse: [...withoutRdvHooks(existingPostToolUse, hookMarkers), postToolUseTodoHook],
    Notification: [...withoutRdvHooks(existingNotification, hookMarkers), notificationHook],
    Stop: [...withoutRdvHooks(existingStop, hookMarkers), stopHook],
    SessionEnd: [...withoutRdvHooks(existingSessionEnd, hookMarkers), sessionEndHook],
    // Remove legacy SessionStart RDV hooks (replaced by PreToolUse)
    ...(cleanedSessionStart.length > 0 ? { SessionStart: cleanedSessionStart } : { SessionStart: undefined }),
  };

  // Remove empty hook arrays to keep settings clean
  if (mergedHooks.SessionStart === undefined || (Array.isArray(mergedHooks.SessionStart) && mergedHooks.SessionStart.length === 0)) {
    delete mergedHooks.SessionStart;
  }

  // Clean up stale MCP server entries from previous installations.
  // The MCP server backend was removed; leftover entries cause silent connection failures.
  const mcpServers = (existingSettings.mcpServers ?? {}) as Record<string, unknown>;
  if ("remote-dev" in mcpServers) {
    delete mcpServers["remote-dev"];
  }

  // Register rdv-peers MCP server for inter-agent communication.
  // RDV env vars must be passed explicitly since MCP servers spawned by Claude Code
  // don't inherit the tmux session environment.
  const peerServerPath = join(import.meta.dirname, "..", "mcp", "peer-server.ts");
  const rdvKeys = ["RDV_SESSION_ID", "RDV_TERMINAL_SOCKET", "RDV_TERMINAL_PORT"] as const;
  const peerMcpEnv: Record<string, string> = {};
  for (const key of rdvKeys) {
    if (rdvEnv?.[key]) peerMcpEnv[key] = rdvEnv[key];
  }
  mcpServers["rdv-peers"] = {
    command: "node",
    args: ["--import", "tsx/esm", peerServerPath],
    env: peerMcpEnv,
  };

  const updatedSettings = {
    ...existingSettings,
    hooks: mergedHooks,
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
  };

  // Skip write if settings are unchanged (hooks already current)
  const newContent = JSON.stringify(updatedSettings, null, 2) + "\n";
  if (newContent === rawContent) return;

  // Ensure .claude directory exists
  await mkdir(join(configDir, ".claude"), { recursive: true });
  await writeFile(settingsPath, newContent);

  // Also clean stale remote-dev MCP entry from .mcp.json (project-scoped MCP config)
  await cleanStaleMcpJson(join(configDir, ".mcp.json"));
  await cleanStaleMcpJson(join(configDir, ".claude", ".mcp.json"));
}

/** Remove stale "remote-dev" entry from an .mcp.json file if present. */
async function cleanStaleMcpJson(mcpJsonPath: string): Promise<void> {
  try {
    const raw = await readFile(mcpJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    const servers = parsed?.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !("remote-dev" in servers)) return;
    delete servers["remote-dev"];
    if (Object.keys(servers).length === 0) {
      // File only had our entry — remove it entirely by writing empty object
      await writeFile(mcpJsonPath, "{}\n");
    } else {
      await writeFile(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n");
    }
  } catch {
    // File doesn't exist or isn't valid JSON — nothing to clean
  }
}

/**
 * Validate that installed hooks are functional.
 * Runs `rdv hook validate` to check server connectivity and session context.
 * If validation fails and rdv is available, reinstalls hooks (auto-repair).
 *
 * @returns validation result with details
 */
export async function validateAgentHooks(
  configDir: string,
  provider: AgentProvider,
  sessionId: string,
  env: Record<string, string>
): Promise<{ valid: boolean; repaired: boolean; error?: string }> {
  if (provider !== "claude") return { valid: true, repaired: false };

  // Check if rdv is available (hooks use curl fallback if not)
  const versionCheck = await execFileNoThrow("rdv", ["--version"], { timeout: 3000 });
  if (versionCheck.exitCode !== 0) {
    return { valid: true, repaired: false };
  }

  const mergedEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;
  const validateResult = await execFileNoThrow("rdv", ["hook", "validate"], {
    timeout: 10000,
    env: mergedEnv,
  });

  // Old rdv binary without the validate subcommand
  if (validateResult.stderr.includes("unrecognized subcommand")) {
    log.warn("rdv binary is outdated (missing hook validate), skipping validation", { sessionId });
    return { valid: true, repaired: false };
  }

  const parsed = safeJsonParse(validateResult.stdout, null as { valid: boolean; checks?: unknown[] } | null);
  if (parsed?.valid) {
    return { valid: true, repaired: false };
  }

  // Validation failed or parse failed -- attempt auto-repair
  log.warn("Hook validation failed, attempting repair", { sessionId, checks: parsed?.checks, stderr: validateResult.stderr });
  await installAgentHooks(configDir, provider);

  // Re-validate after repair
  const retryResult = await execFileNoThrow("rdv", ["hook", "validate"], {
    timeout: 10000,
    env: mergedEnv,
  });
  const retryParsed = safeJsonParse(retryResult.stdout, null as { valid: boolean } | null);
  if (retryParsed?.valid) {
    log.info("Hook auto-repair succeeded", { sessionId });
    return { valid: true, repaired: true };
  }

  return { valid: false, repaired: true, error: "Auto-repair failed: hooks still invalid after reinstall" };
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
    log.error("Failed to parse provider config for profile", { profileId, error: String(error) });
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

// Re-export error class from centralized location for backwards compatibility
export { AgentProfileServiceError } from "@/lib/errors";
