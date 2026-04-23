/**
 * SessionService - Manages terminal session lifecycle and persistence
 */
import { db } from "@/db";
import { terminalSessions, githubRepositories, apiKeys } from "@/db/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import type {
  TerminalSession,
  CreateSessionInput,
  UpdateSessionInput,
  SessionStatus,
  SessionWithMetadata,
  AgentProviderType,
  WorktreeType,
} from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";
import type { TerminalType } from "@/types/terminal-type";
import * as TmuxService from "./tmux-service";
import * as WorktreeService from "./worktree-service";
import * as GitHubService from "./github-service";
import * as AgentProfileService from "./agent-profile-service";
import { getResolvedPreferences, getFolderPreferences, getEnvironmentForSession, getFolderGitIdentity } from "./preferences-service";
import { SessionServiceError } from "@/lib/errors";
import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
import { initializeServerPlugins } from "@/lib/terminal-plugins/init-server";
import { githubAccountRepository, gitCredentialManager } from "@/infrastructure/container";
import { GitHubAccountEnvironment } from "@/domain/value-objects/GitHubAccountEnvironment";
import { createApiKey } from "@/services/api-key-service";
import { createLogger } from "@/lib/logger";
import { ensureSoxShim } from "@/services/voice-shim-service";

const log = createLogger("SessionService");

// Initialize server-side plugins on module load. Uses the server-only
// registry so this module graph never transitively imports React / Lucide.
initializeServerPlugins();

// Re-export for backwards compatibility with API routes
export { SessionServiceError };

/**
 * Decide if a session's terminal type uses tmux. Reads the declarative
 * `useTmux` flag from the server plugin registry. Falls back to `true`
 * for unknown types so legacy/unregistered shell sessions continue to
 * work (safer default than skipping killSession for a real PTY-backed
 * session).
 */
function sessionUsesTmux(session: TerminalSession): boolean {
  return TerminalTypeServerRegistry.get(session.terminalType)?.useTmux ?? true;
}

/**
 * Resolve git credential suppression env vars for a session.
 * Returns GIT_TERMINAL_PROMPT=0 and optionally GIT_CONFIG_GLOBAL for non-profile sessions.
 */
async function resolveGitCredentialEnv(
  sessionId: string,
  hasProfile: boolean
): Promise<Record<string, string>> {
  try {
    const env = await gitCredentialManager.buildSessionEnv(sessionId, hasProfile);
    return env.toRecord();
  } catch (error) {
    log.error("Failed to build git credential env", { sessionId, error: String(error) });
    return {};
  }
}

/**
 * Resolve LiteLLM proxy env for Claude agent sessions.
 * When the proxy is running, returns ANTHROPIC_BASE_URL pointing at the local proxy
 * and ANTHROPIC_API_KEY set to the LiteLLM master key for authentication.
 * When the proxy is not running, checks for a direct-endpoint model and injects its URL + decrypted key.
 */
async function resolveProxyEnv(agentProvider: string, userId: string): Promise<Record<string, string>> {
  if (agentProvider !== "claude") return {};
  try {
    const { litellmProcessManager } = await import("@/services/litellm-process-manager");
    const LiteLLMService = await import("@/services/litellm-service");
    const { decrypt } = await import("@/lib/encryption");

    if (litellmProcessManager.isRunning()) {
      // getPort() returns null when the process was started by another server instance.
      // Fall back to the user's configured port from the DB.
      let port = litellmProcessManager.getPort();
      if (!port) {
        const config = await LiteLLMService.getConfig(userId);
        port = config?.port ?? null;
      }
      if (port) {
        const env: Record<string, string> = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };
        // Inject the LiteLLM master key as ANTHROPIC_API_KEY
        // (LiteLLM validates incoming requests against this key)
        const proxyModel = await LiteLLMService.getActiveDefaultModel(userId);
        if (proxyModel?.masterKey) {
          env.ANTHROPIC_API_KEY = proxyModel.masterKey;
        }
        return env;
      }
    }

    // Proxy not running — check for a direct-endpoint model to auto-inject
    const directModel = await LiteLLMService.getActiveDirectModel(userId);
    if (directModel) {
      return {
        ANTHROPIC_BASE_URL: directModel.apiBase,
        ANTHROPIC_API_KEY: decrypt(directModel.encryptedKey),
      };
    }
  } catch (error) {
    log.warn("Failed to resolve proxy env", { error: String(error) });
  }
  return {};
}

/**
 * Resolve folder-level git identity override env vars (pseudonymous commits).
 */
async function resolveFolderGitIdentityEnv(
  userId: string,
  folderId: string | null | undefined
): Promise<Record<string, string>> {
  try {
    const { env } = await getFolderGitIdentity(userId, folderId);
    return env ?? {};
  } catch (error) {
    log.error("Failed to resolve folder git identity", { folderId, error: String(error) });
    return {};
  }
}

/**
 * Result of createSession. `reused` is true when scope-key dedup returned
 * an existing row instead of creating a new one; the client uses this to
 * avoid inserting a duplicate into local state.
 */
export interface CreateSessionResult {
  session: TerminalSession;
  reused: boolean;
}

/**
 * Create a new terminal session.
 *
 * SECURITY: Wraps tmux creation with proper cleanup on DB failure.
 *
 * Dedup rule: when `input.scopeKey` is a non-empty string, this function
 * first looks up an existing non-closed session belonging to the same user
 * with the same `(terminalType, scopeKey)` and returns it instead of
 * creating a new one. When multiple matches exist, the most recently
 * active row wins. The returned row is left in whatever state it was in
 * (including `suspended`) — callers are responsible for calling
 * `resumeSession` if they need it to be active.
 *
 * Back-compat: this function still returns `TerminalSession` directly. New
 * callers that need to distinguish "newly created" from "reused" should
 * call {@link createSessionWithDedupFlag}.
 */
export async function createSession(
  userId: string,
  input: CreateSessionInput
): Promise<TerminalSession> {
  const { session } = await createSessionWithDedupFlag(userId, input);
  return session;
}

/**
 * Variant of {@link createSession} that also reports whether the returned
 * row was reused via scope-key dedup. API routes use this to surface the
 * reused signal to the client so it can dispatch UPDATE instead of CREATE
 * (avoiding duplicate entries in local state).
 */
export async function createSessionWithDedupFlag(
  userId: string,
  input: CreateSessionInput
): Promise<CreateSessionResult> {
  // Phase G0a: terminal_session.project_id is NOT NULL. Reject upfront with a
  // clear error instead of letting the DB insert fail with an opaque FK message.
  if (!input.projectId) {
    throw new SessionServiceError(
      "projectId is required to create a session",
      "PROJECT_ID_REQUIRED"
    );
  }

  // Resolve terminal type early — plugins drive most downstream decisions.
  // Priority: explicit terminalType > agent auto-launch > shell default.
  let terminalType: TerminalType = input.terminalType ?? "shell";
  if (
    !input.terminalType &&
    input.agentProvider &&
    input.agentProvider !== "none" &&
    input.autoLaunchAgent
  ) {
    terminalType = "agent";
  }

  // Scope-key dedup: return the existing open session if one matches.
  // Must happen before we allocate a new sessionId / tmux name.
  if (input.scopeKey) {
    const existing = await db.query.terminalSessions.findMany({
      where: and(
        eq(terminalSessions.userId, userId),
        eq(terminalSessions.terminalType, terminalType),
        eq(terminalSessions.scopeKey, input.scopeKey),
        inArray(terminalSessions.status, ["active", "suspended"])
      ),
      orderBy: [desc(terminalSessions.lastActivityAt)],
      limit: 1,
    });
    if (existing.length > 0) {
      const existingRow = existing[0];
      log.debug("Reusing existing scope-keyed session", {
        sessionId: existingRow.id,
        terminalType,
        scopeKey: input.scopeKey,
      });

      // F4: singleton tabs (Settings, Recordings, Profiles) are pinned to the
      // project they were opened from but conceptually belong to the user. If
      // the caller is on a different project now, re-anchor the row to the
      // current project so the sidebar renders the tab under the active
      // project instead of hiding it under the original carrier. We only
      // rewrite when the caller passed a projectId that differs from the
      // stored one — otherwise dedup is a pure read.
      let finalRow = existingRow;
      if (
        input.projectId &&
        existingRow.projectId &&
        existingRow.projectId !== input.projectId
      ) {
        const [updated] = await db
          .update(terminalSessions)
          .set({
            projectId: input.projectId,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(terminalSessions.id, existingRow.id),
              eq(terminalSessions.userId, userId)
            )
          )
          .returning();
        if (updated) finalRow = updated;
      }

      return { session: mapDbSessionToSession(finalRow), reused: true };
    }
  }

  const sessionId = crypto.randomUUID();
  const tmuxSessionName = TmuxService.generateSessionName(sessionId);

  // Delegate plugin-specific decisions (tmux usage, shell command, initial
  // typeMetadata, env overlays) to the server-side terminal type plugin.
  // Callers with no registered plugin fall back to the shell plugin so
  // legacy clients keep working.
  const plugin = TerminalTypeServerRegistry.getOrDefault(terminalType);

  // Let the plugin validate input up-front — fail fast before we allocate
  // any external resources.
  if (plugin.validateInput) {
    const validationError = plugin.validateInput(input);
    if (validationError) {
      throw new SessionServiceError(validationError, "VALIDATION_ERROR", sessionId);
    }
  }

  // Build a partial session stub for the plugin to introspect if needed.
  const pluginSessionStub: Partial<TerminalSession> = {
    id: sessionId,
    userId,
    name: input.name,
    projectId: input.projectId,
    profileId: input.profileId ?? null,
    terminalType,
    agentProvider: input.agentProvider ?? "claude",
  };

  // Pre-resolve folder/profile-level startup command so agent-style plugins
  // can honor wrappers like `jclaude`. Preferences come from the folder tree
  // first, then user settings. An explicit `input.startupCommand` (e.g. from
  // the New Session wizard) takes precedence over preferences. The resolved
  // value is threaded into `plugin.createSession` via `startupCommandOverride`.
  const earlyPreferences = input.projectId
    ? await getResolvedPreferences(userId, input.projectId)
    : null;
  const resolvedStartupCommand =
    input.startupCommand !== undefined
      ? input.startupCommand || undefined
      : earlyPreferences?.startupCommand || undefined;

  // Pass to the plugin via a mutated input copy so agent-style plugins see
  // the override. Non-agent plugins ignore it. We deliberately mutate a
  // shallow copy to avoid leaking the override back onto caller state.
  const pluginInput: CreateSessionInput = {
    ...input,
    startupCommandOverride: resolvedStartupCommand,
  };

  // SessionConfig drives tmux creation + shell command selection below.
  const sessionConfig = await plugin.createSession(
    pluginInput,
    pluginSessionStub
  );

  // Merge plugin metadata with any caller-supplied metadata. Caller wins on
  // key conflicts so API clients can override plugin defaults if needed.
  const pluginMetadata = (sessionConfig.metadata ?? null) as
    | Record<string, unknown>
    | null;
  const mergedMetadata: Record<string, unknown> | null =
    pluginMetadata || input.typeMetadata
      ? { ...(pluginMetadata ?? {}), ...(input.typeMetadata ?? {}) }
      : null;
  const typeMetadata: string | null = mergedMetadata
    ? JSON.stringify(mergedMetadata)
    : null;

  // Get the next tab order
  const existingSessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      inArray(terminalSessions.status, ["active", "suspended"])
    ),
    orderBy: [desc(terminalSessions.tabOrder)],
    limit: 1,
  });

  const nextTabOrder = existingSessions.length > 0
    ? existingSessions[0].tabOrder + 1
    : 0;

  // Reuse early-resolved preferences when available, else fetch now (e.g.
  // when the caller didn't go through the scope-key guarded path).
  const preferences = earlyPreferences
    ?? await getResolvedPreferences(userId, input.projectId);

  // Determine working path and branch name
  let workingPath = input.projectPath ?? preferences.defaultWorkingDirectory ?? process.env.HOME;
  let branchName = input.worktreeBranch;

  // Handle worktree creation from folder context (resolves repo from folder preferences)
  if (input.createWorktree && input.projectId) {
    // Get folder preferences to find linked repository
    const folderPrefs = await getFolderPreferences(input.projectId, userId);

    let repoPath: string | null = null;
    let repoId: string | null = null;

    // Priority for finding git repo:
    // 1. localRepoPath (explicit repo path for worktrees)
    // 2. defaultWorkingDirectory (if it's a git repo - common case)
    // 3. githubRepoId.localPath (cached clone in ~/.remote-dev/repos)
    if (folderPrefs?.localRepoPath) {
      // User's explicit local repository path takes priority
      repoPath = folderPrefs.localRepoPath;
      // Still get repoId for metadata if available
      if (folderPrefs.githubRepoId) {
        repoId = folderPrefs.githubRepoId;
      }
    } else if (folderPrefs?.defaultWorkingDirectory) {
      // Check if defaultWorkingDirectory is a git repo
      if (await WorktreeService.isGitRepo(folderPrefs.defaultWorkingDirectory)) {
        repoPath = folderPrefs.defaultWorkingDirectory;
        if (folderPrefs.githubRepoId) {
          repoId = folderPrefs.githubRepoId;
        }
      }
    }

    // Fallback to GitHub repo's cached location if no local path found
    if (!repoPath && folderPrefs?.githubRepoId) {
      const repo = await GitHubService.getRepository(folderPrefs.githubRepoId, userId);
      if (!repo?.localPath) {
        throw new SessionServiceError(
          "Repository is not cloned locally. Clone it first.",
          "REPO_NOT_CLONED",
          sessionId
        );
      }
      repoPath = repo.localPath;
      repoId = repo.id;
    }

    if (!repoPath) {
      throw new SessionServiceError(
        "No git repository found. Set a project folder that contains a git repo, or link a GitHub repo in folder preferences.",
        "NO_REPO_LINKED",
        sessionId
      );
    }

    // Validate it's a git repo
    if (!(await WorktreeService.isGitRepo(repoPath))) {
      throw new SessionServiceError(
        "Linked path is not a git repository",
        "NOT_GIT_REPO",
        sessionId
      );
    }

    // Use explicit branch name if provided, otherwise generate from description or timestamp
    if (!branchName) {
      if (input.featureDescription) {
        const prefix = input.worktreeType ?? "feature";
        branchName = `${prefix}/${WorktreeService.sanitizeBranchName(input.featureDescription)}`;
      } else {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
        branchName = `wt-${timestamp}`;
      }
    }

    // Create the worktree with new branch
    const result = await createWorktreeWithErrorHandling(
      repoPath,
      branchName,
      input.baseBranch,
      sessionId
    );
    workingPath = result.worktreePath;

    // Update input for database record
    if (repoId) {
      input.githubRepoId = repoId;
    }
  }

  // Handle worktree creation with explicit projectPath (no folder context, e.g. direct API calls)
  if (input.createWorktree && !input.projectId && input.projectPath && !branchName) {
    const prefix = input.worktreeType ?? "feature";
    const description = input.featureDescription || crypto.randomUUID().substring(0, 8);
    const sanitizedBranch = `${prefix}/${WorktreeService.sanitizeBranchName(description)}`;
    branchName = sanitizedBranch;

    if (!(await WorktreeService.isGitRepo(input.projectPath))) {
      throw new SessionServiceError(
        "Project path is not a git repository",
        "NOT_GIT_REPO",
        sessionId
      );
    }

    const result = await createWorktreeWithErrorHandling(
      input.projectPath,
      sanitizedBranch,
      input.baseBranch,
      sessionId
    );
    workingPath = result.worktreePath;
  }

  // Determine startup command (explicit override takes precedence)
  // Mirrors the early resolution above so downstream code still has access.
  let startupCommand = resolvedStartupCommand;

  // Handle agent-aware session: auto-launch the agent CLI
  // Use the folder's startupCommand as the base command if set (e.g., `jclaude`
  // wrapper), otherwise fall back to the provider's default command (e.g., `claude`).
  // The agent command replaces any plain startup command to avoid duplication.
  if (input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent) {
    // For loop sessions with Claude, add --output-format stream-json for structured output parsing
    const agentFlags = [...(input.agentFlags ?? [])];
    if (input.terminalType === "loop" && input.agentProvider === "claude" && !agentFlags.includes("--output-format")) {
      agentFlags.push("--output-format", "stream-json");
    }
    const agentCommand = buildAgentCommand(input.agentProvider, agentFlags, startupCommand);
    if (agentCommand) {
      startupCommand = agentCommand;
    }
  }

  // Fetch profile and its environment overlay if profile is specified
  let profileEnv: Record<string, string> | undefined;
  const profile = input.profileId
    ? await AgentProfileService.getProfile(input.profileId, userId)
    : undefined;
  if (profile) {
    const env = await AgentProfileService.getProfileEnvironment(input.profileId!, userId, profile);
    if (env) {
      profileEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );
    }
  }

  // Fetch folder environment variables for the session
  const folderEnv = await getEnvironmentForSession(userId, input.projectId);

  // Determine if this is an agent session early — needed for env var injection
  // Check both explicit agent flags AND terminalType (profiles set terminalType
  // but may not send agentProvider/autoLaunchAgent separately)
  const isAgentSession =
    (input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent) ||
    input.terminalType === "agent" ||
    input.terminalType === "loop";
  const effectiveAgentProvider = input.agentProvider && input.agentProvider !== "none"
    ? input.agentProvider
    : "claude"; // Default matches DB default on line ~350

  // RDV env vars for agent hook callbacks (session ID + terminal server address)
  // Socket mode (prod): uses TERMINAL_SOCKET; Port mode (dev): uses TERMINAL_PORT
  const terminalSocket = process.env.TERMINAL_SOCKET;
  log.debug("Session creation details", { sessionId, isAgentSession: !!isAgentSession, provider: effectiveAgentProvider, terminalType: input.terminalType });
  // Auto-create API key for agent sessions so they can make authenticated API calls
  let agentApiKey: string | undefined;
  if (isAgentSession) {
    try {
      const keyName = `agent-session-${sessionId}`;
      // Delete any stale keys for this session before creating a new one
      await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.name, keyName)));
      const keyResult = await createApiKey(userId, keyName);
      agentApiKey = keyResult.key;
    } catch (error) {
      log.error("Failed to create API key for agent session", { sessionId, error: String(error) });
      // Non-fatal: agent can still work without API key
    }
  }

  // Install sox shim for voice mode support in agent sessions.
  // Must happen before tmux session creation so the shim PATH is in the
  // initial environment when the agent process starts.
  let voiceShimDir: string | undefined;
  if (isAgentSession) {
    try {
      voiceShimDir = ensureSoxShim();
    } catch (error) {
      log.warn("Failed to install voice sox shim", { sessionId, error: String(error) });
    }
  }

  const rdvEnv: Record<string, string> = isAgentSession
    ? {
        RDV_SESSION_ID: sessionId,
        ...(terminalSocket
          ? { RDV_TERMINAL_SOCKET: terminalSocket }
          : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "6002" }),
        ...(process.env.SOCKET_PATH
          ? { RDV_API_SOCKET: process.env.SOCKET_PATH }
          : { RDV_API_PORT: process.env.PORT ?? "6001" }),
        ...(agentApiKey ? { RDV_API_KEY: agentApiKey } : {}),
        // Prepend sox shim directory to PATH so Claude Code's voice mode
        // uses our shim (reads from FIFO) instead of the real sox (CoreAudio)
        ...(voiceShimDir ? { PATH: `${voiceShimDir}:${process.env.PATH ?? ""}` } : {}),
      }
    : {};

  // Install agent hooks and MCP config BEFORE tmux session creation so the
  // agent picks them up at startup (Claude Code reads settings once on launch)
  if (isAgentSession) {
    const configDir = profile?.configDir ?? process.env.HOME;
    if (configDir) {
      const configDirs = await resolveAgentConfigDirs(configDir, startupCommand, sessionId);
      await ensureAgentConfig(configDirs, effectiveAgentProvider, sessionId, rdvEnv);
    }
  }

  // Resolve GitHub account environment for the session's folder binding
  // This MUST happen before tmux session creation so agent processes inherit it at spawn
  let ghAccountEnv: Record<string, string> | null = null;
  try {
    // Find the GitHub account bound to this project (or fall back to default)
    const account = input.projectId
      ? await githubAccountRepository.findByProject(input.projectId)
      : null;
    const effectiveAccount = account ?? await githubAccountRepository.findDefault(userId);

    if (effectiveAccount) {
      const token = await githubAccountRepository.getAccessToken(
        effectiveAccount.providerAccountId,
        userId
      );
      if (token) {
        const ghEnv = GitHubAccountEnvironment.create(
          token,
          effectiveAccount.configDir,
          effectiveAccount.login
        );
        ghAccountEnv = ghEnv.toEnvironment().toRecord();
      }
    }
  } catch (error) {
    log.error("Failed to resolve GitHub account env", { sessionId, error: String(error) });
  }

  const proxyEnv = isAgentSession
    ? await resolveProxyEnv(effectiveAgentProvider, userId)
    : {};

  // The plugin decides whether tmux is needed via its declarative
  // `useTmux` flag. File/browser sessions opt out — no shell command,
  // no PTY. `SessionConfig.useTmux` is kept in lock-step for callers
  // that still read from the returned config.
  if (plugin.useTmux) {
    const gitCredentialEnv = await resolveGitCredentialEnv(sessionId, !!profile);
    const folderGitIdentityEnv = await resolveFolderGitIdentityEnv(userId, input.projectId);

    // Claude Code agent defaults (lowest precedence — overridable via profile/folder env)
    const claudeAgentDefaults: Record<string, string> = isAgentSession && effectiveAgentProvider === "claude" && terminalType !== "loop"
      ? { CLAUDE_CODE_NO_FLICKER: "1" }
      : {};

    // Initial environment — all must be present at PTY spawn so agent processes inherit them immediately.
    // Precedence (low → high): claudeAgentDefaults < pluginEnv < profileEnv < proxyEnv < folderEnv <
    //   folderGitIdentityEnv < gitCredentialEnv < ghAccountEnv < rdvEnv.
    const initialEnv: Record<string, string> = {
      ...claudeAgentDefaults,
      ...(sessionConfig.environment ?? {}),
      ...(profileEnv ?? {}),
      ...proxyEnv,
      ...(folderEnv ?? {}),
      ...folderGitIdentityEnv,
      ...gitCredentialEnv,
      ...(ghAccountEnv ?? {}),
      ...rdvEnv,
    };
    log.debug("Session initial env keys", { sessionId, keys: Object.keys(initialEnv) });

    // Prefer the plugin-provided shell command when set — e.g. the agent
    // plugin returns the CLI command so the agent runs as tmux's shell and
    // the session exits when it exits. Fall back to the resolved user
    // startup command otherwise.
    const effectiveStartupCommand = sessionConfig.shellCommand ?? startupCommand;
    const effectiveCwd = sessionConfig.cwd ?? workingPath ?? undefined;

    // Create the tmux session with initial environment for PTY spawn
    try {
      await TmuxService.createSession(
        tmuxSessionName,
        effectiveCwd,
        effectiveStartupCommand,
        Object.keys(initialEnv).length > 0 ? initialEnv : undefined
      );
    } catch (error) {
      if (error instanceof TmuxService.TmuxServiceError) {
        throw new SessionServiceError(
          `Failed to create tmux session: ${error.message}`,
          "TMUX_CREATE_FAILED",
          sessionId
        );
      }
      throw error;
    }

    // Persistent session-level environment variables
    // These survive shell exits and are inherited by all new shells in the session
    if (Object.keys(initialEnv).length > 0) {
      try {
        await TmuxService.setSessionEnvironment(tmuxSessionName, initialEnv);
      } catch (error) {
        log.error("Failed to set session environment", { tmuxSessionName, error: String(error) });
      }
    }

    // Set up agent exit detection hook for agent-type sessions
    // This allows the terminal server to be notified when the agent process exits
    if (isAgentSession) {
      try {
        const exitUrl = `/internal/agent-exit?sessionId=${sessionId}`;
        const curlCmd = terminalSocket
          ? `curl --unix-socket '${terminalSocket}' -sS -X POST http://localhost${exitUrl}`
          : `curl -sS -X POST http://localhost:${rdvEnv.RDV_TERMINAL_PORT}${exitUrl}`;
        await TmuxService.setHook(
          tmuxSessionName,
          "pane-exited",
          `run-shell "${curlCmd} || true"`
        );
      } catch (error) {
        // Log but don't fail session creation - the session is already running
        log.error("Failed to set agent exit hook", { tmuxSessionName, error: String(error) });
      }
    }
  }

  // Track if we created a worktree so we can clean it up on failure
  const createdWorktree = input.createWorktree && branchName && workingPath !== input.projectPath;
  const repoPath = input.projectPath;

  // `terminalType`, `plugin`, `typeMetadata` were resolved up-front; see the
  // dedup + plugin-delegation block near the top of createSession.

  // Insert the database record - clean up tmux session and worktree if this fails
  try {
    const now = new Date();
    const [session] = await db
      .insert(terminalSessions)
      .values({
        id: sessionId,
        userId,
        name: input.name,
        tmuxSessionName,
        projectPath: workingPath ?? null,
        githubRepoId: input.githubRepoId ?? null,
        worktreeBranch: branchName ?? null,
        worktreeType: input.worktreeType ?? null,
        projectId: input.projectId,
        profileId: input.profileId ?? null,
        parentSessionId: input.parentSessionId ?? null,
        terminalType,
        typeMetadata,
        scopeKey: input.scopeKey ?? null,
        agentProvider: input.agentProvider ?? "claude",
        // Set agent state for agent/loop terminal types
        agentExitState: (terminalType === "agent" || terminalType === "loop") ? "running" : null,
        agentExitCode: null,
        agentExitedAt: null,
        agentRestartCount: 0,
        status: "active",
        tabOrder: nextTabOrder,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return { session: mapDbSessionToSession(session), reused: false };
  } catch (error) {
    // F7: race handling. When two concurrent createSession calls both pass
    // the initial SELECT (no existing match) and reach INSERT, the unique
    // index on (user_id, terminal_type, scope_key) makes one INSERT fail.
    // Re-run the SELECT to retrieve the winner and return it as a reused
    // row so the client sees the same result as a plain dedup hit.
    const errorText = String(error);
    const isUniqueViolation =
      input.scopeKey &&
      (errorText.includes("UNIQUE") ||
        errorText.includes("SQLITE_CONSTRAINT") ||
        errorText.includes("constraint failed"));

    if (isUniqueViolation) {
      const existingAfterRace = await db.query.terminalSessions.findMany({
        where: and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.terminalType, terminalType),
          eq(terminalSessions.scopeKey, input.scopeKey!),
          inArray(terminalSessions.status, ["active", "suspended"])
        ),
        orderBy: [desc(terminalSessions.lastActivityAt)],
        limit: 1,
      });
      if (existingAfterRace.length > 0) {
        log.info("Recovered from scope-key INSERT race", {
          sessionId: existingAfterRace[0].id,
          terminalType,
          scopeKey: input.scopeKey,
        });
        // Clean up the tmux/worktree resources we allocated for the
        // losing-side INSERT — the winner already owns its own.
        await TmuxService.killSession(tmuxSessionName).catch(() => {
          log.error("Failed to clean up orphaned tmux after race", {
            tmuxSessionName,
          });
        });
        return {
          session: mapDbSessionToSession(existingAfterRace[0]),
          reused: true,
        };
      }
    }

    // SECURITY: Clean up orphaned resources if DB insert fails
    const cleanupPromises: Promise<void>[] = [
      // Clean up orphaned tmux session
      TmuxService.killSession(tmuxSessionName).catch(() => {
        log.error("Failed to clean up orphaned tmux session", { tmuxSessionName });
      }),
    ];

    // Clean up orphaned worktree if we created one
    if (createdWorktree && repoPath && workingPath) {
      cleanupPromises.push(
        WorktreeService.removeWorktree(repoPath, workingPath, true)
          .then(() => {}) // Discard result to match Promise<void> type
          .catch(() => {
            log.error("Failed to clean up orphaned worktree", { worktreePath: workingPath });
          })
      );
    }

    await Promise.all(cleanupPromises);
    throw error;
  }
}

/**
 * Get a session by ID (with user ownership check)
 */
export async function getSession(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sessionId),
      eq(terminalSessions.userId, userId)
    ),
  });

  return session ? mapDbSessionToSession(session) : null;
}

/**
 * Get a session with repository metadata
 */
export async function getSessionWithMetadata(
  sessionId: string,
  userId: string
): Promise<SessionWithMetadata | null> {
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sessionId),
      eq(terminalSessions.userId, userId)
    ),
  });

  if (!session) {
    return null;
  }

  let repository = null;
  if (session.githubRepoId) {
    const repo = await db.query.githubRepositories.findFirst({
      where: eq(githubRepositories.id, session.githubRepoId),
    });
    if (repo) {
      repository = {
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
      };
    }
  }

  return {
    ...mapDbSessionToSession(session),
    repository,
  };
}

/**
 * List all sessions for a user
 */
export async function listSessions(
  userId: string,
  status?: SessionStatus | SessionStatus[],
  parentSessionId?: string
): Promise<TerminalSession[]> {
  const statusFilter = Array.isArray(status) ? status : status ? [status] : null;
  const conditions = [eq(terminalSessions.userId, userId)];

  if (statusFilter && statusFilter.length > 0) {
    conditions.push(inArray(terminalSessions.status, statusFilter));
  }

  if (parentSessionId) {
    conditions.push(eq(terminalSessions.parentSessionId, parentSessionId));
  }

  const sessions = await db.query.terminalSessions.findMany({
    where: conditions.length > 1 ? and(...conditions) : conditions[0],
    orderBy: [asc(terminalSessions.tabOrder)],
  });

  return sessions.map(mapDbSessionToSession);
}

/**
 * Update a session
 */
export async function updateSession(
  sessionId: string,
  userId: string,
  updates: UpdateSessionInput
): Promise<TerminalSession> {
  const existing = await getSession(sessionId, userId);
  if (!existing) {
    throw new SessionServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      sessionId
    );
  }

  // If status is being changed to closed, kill the tmux session
  if (updates.status === "closed" && existing.status !== "closed") {
    await TmuxService.killSession(existing.tmuxSessionName).catch((err) => {
      log.error("Failed to kill tmux session during status update", { error: err.message });
    });
  }

  // Build the DB-level updates, handling typeMetadataPatch merge
  const { typeMetadataPatch, ...directUpdates } = updates;
  let mergedTypeMetadata: string | undefined;

  if (typeMetadataPatch) {
    let meta: Record<string, unknown> = {};
    if (existing.typeMetadata) {
      meta = { ...existing.typeMetadata };
    }
    for (const [key, value] of Object.entries(typeMetadataPatch)) {
      if (value === null) {
        delete meta[key];
      } else {
        meta[key] = value;
      }
    }
    mergedTypeMetadata = JSON.stringify(meta);
  }

  const [updated] = await db
    .update(terminalSessions)
    .set({
      ...directUpdates,
      ...(mergedTypeMetadata !== undefined ? { typeMetadata: mergedTypeMetadata } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    )
    .returning();

  return mapDbSessionToSession(updated);
}

/**
 * Update last activity timestamp
 */
export async function touchSession(
  sessionId: string,
  userId: string
): Promise<void> {
  await db
    .update(terminalSessions)
    .set({
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent State Management (applies to any terminal type whose plugin opts in
// by defining `onSessionExit`/`onSessionRestart` — e.g. `agent`, `loop`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a session's plugin participates in the agent exit/restart
 * lifecycle. Plugins signal opt-in by defining `onSessionExit`.
 */
function supportsAgentLifecycle(session: TerminalSession): boolean {
  const plugin = TerminalTypeServerRegistry.get(session.terminalType);
  return Boolean(plugin?.onSessionExit);
}

/**
 * Mark agent as exited with exit code.
 * Called by terminal server when it detects the agent process has exited.
 * No-op (returns null) if the session's plugin does not define `onSessionExit`.
 */
export async function markAgentExited(
  sessionId: string,
  userId: string,
  exitCode: number | null
): Promise<TerminalSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session || !supportsAgentLifecycle(session)) {
    return null;
  }

  const now = new Date();
  const [updated] = await db
    .update(terminalSessions)
    .set({
      agentExitState: "exited",
      agentExitCode: exitCode,
      agentExitedAt: now,
      agentActivityStatus: exitCode != null && exitCode !== 0 ? "error" : "idle",
      updatedAt: now,
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Mark agent as restarting (user clicked restart).
 * Increments restart count. No-op for plugins that don't define
 * `onSessionRestart`.
 */
export async function markAgentRestarting(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session) return null;
  const plugin = TerminalTypeServerRegistry.get(session.terminalType);
  if (!plugin?.onSessionRestart) return null;

  const now = new Date();
  const [updated] = await db
    .update(terminalSessions)
    .set({
      agentExitState: "restarting",
      agentActivityStatus: "running",
      agentRestartCount: (session.agentRestartCount ?? 0) + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Mark agent as running (after restart completes).
 * Clears exit code and exit time. No-op for plugins that don't opt into
 * the agent lifecycle.
 */
export async function markAgentRunning(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session || !supportsAgentLifecycle(session)) {
    return null;
  }

  const now = new Date();
  const [updated] = await db
    .update(terminalSessions)
    .set({
      agentExitState: "running",
      agentExitCode: null,
      agentExitedAt: null,
      agentActivityStatus: "running",
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Mark agent session as closed (won't be restarted).
 * Called when user chooses to close instead of restart. No-op for plugins
 * that don't opt into the agent lifecycle.
 */
export async function markAgentClosed(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session || !supportsAgentLifecycle(session)) {
    return null;
  }

  const now = new Date();
  const [updated] = await db
    .update(terminalSessions)
    .set({
      agentExitState: "closed",
      agentActivityStatus: "idle",
      updatedAt: now,
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Suspend a session (detach tmux, keep alive)
 * SECURITY: Includes userId in WHERE clause to prevent TOCTOU attacks
 */
export async function suspendSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) {
    throw new SessionServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      sessionId
    );
  }

  await db
    .update(terminalSessions)
    .set({
      status: "suspended",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    );
}

/**
 * Resume a suspended session
 * SECURITY: Includes userId in WHERE clause to prevent TOCTOU attacks
 */
export async function resumeSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) {
    throw new SessionServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      sessionId
    );
  }

  // Plugin decides whether tmux is involved. If the plugin reports
  // `useTmux: false` (file viewer, browser), there's no tmux session to
  // resume — just flip the status and return.
  if (!sessionUsesTmux(session)) {
    await db
      .update(terminalSessions)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(terminalSessions.id, sessionId), eq(terminalSessions.userId, userId)));
    return;
  }

  // Check if tmux session still exists
  const exists = await TmuxService.sessionExists(session.tmuxSessionName);
  if (!exists) {
    throw new SessionServiceError(
      "Tmux session no longer exists",
      "TMUX_SESSION_GONE",
      sessionId
    );
  }

  // For agent-lifecycle sessions (agent, loop), ensure hooks, MCP config,
  // and env vars are up to date on resume. This handles upgrades
  // (e.g., hook format changes) and sessions created before hooks/MCP
  // were installed.
  if (supportsAgentLifecycle(session)) {
    const agentProvider = (session.agentProvider ?? "claude") as AgentProviderType;
    const configDir = session.profileId
      ? (await AgentProfileService.getProfile(session.profileId, userId))?.configDir
      : process.env.HOME;

    // Refresh RDV + GitHub account env vars on resume (may be missing on older
    // sessions, or stale if the folder's account binding or OAuth token changed)
    try {
      // Create a fresh API key for the resumed agent session
      let agentApiKey: string | undefined;
      try {
        const keyName = `agent-session-${sessionId}`;
        // Delete stale keys before creating a fresh one
        await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.name, keyName)));
        const keyResult = await createApiKey(userId, keyName);
        agentApiKey = keyResult.key;
      } catch (error) {
        log.error("Failed to create API key on resume", { sessionId, error: String(error) });
      }

      const terminalSocket = process.env.TERMINAL_SOCKET;
      const rdvEnv: Record<string, string> = {
        RDV_SESSION_ID: sessionId,
        ...(terminalSocket
          ? { RDV_TERMINAL_SOCKET: terminalSocket }
          : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "6002" }),
        ...(process.env.SOCKET_PATH
          ? { RDV_API_SOCKET: process.env.SOCKET_PATH }
          : { RDV_API_PORT: process.env.PORT ?? "6001" }),
        ...(agentApiKey ? { RDV_API_KEY: agentApiKey } : {}),
      };

      if (configDir && agentProvider !== "none") {
        // On resume, refresh hooks/MCP config with current rdvEnv so peer MCP server gets env vars
        await ensureAgentConfig(new Set([configDir]), agentProvider, sessionId, rdvEnv);
      }

      let ghAccountEnv: Record<string, string> = {};
      try {
        const account = session.projectId
          ? await githubAccountRepository.findByProject(session.projectId)
          : null;
        const effectiveAccount = account ?? await githubAccountRepository.findDefault(userId);
        if (effectiveAccount) {
          const token = await githubAccountRepository.getAccessToken(
            effectiveAccount.providerAccountId,
            userId
          );
          if (token) {
            ghAccountEnv = GitHubAccountEnvironment.create(
              token, effectiveAccount.configDir, effectiveAccount.login
            ).toEnvironment().toRecord();
          }
        }
      } catch (error) {
        log.error("Failed to resolve GitHub account env on resume", { sessionId, error: String(error) });
      }

      const gitCredentialEnv = await resolveGitCredentialEnv(sessionId, !!session.profileId);
      const folderGitIdentityEnv = await resolveFolderGitIdentityEnv(userId, session.projectId);

      const proxyEnv = await resolveProxyEnv(agentProvider, userId);

      await TmuxService.setSessionEnvironment(session.tmuxSessionName, {
        ...proxyEnv,
        ...folderGitIdentityEnv,
        ...gitCredentialEnv,
        ...ghAccountEnv,
        ...rdvEnv,
      });
    } catch (error) {
      log.error("Failed to set env on resume", { sessionId, error: String(error) });
    }
  }

  await db
    .update(terminalSessions)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    );
}

/**
 * Close a session (kill tmux, mark as closed)
 * SECURITY: Includes userId in WHERE clause to prevent TOCTOU attacks
 */
export async function closeSession(
  sessionId: string,
  userId: string
): Promise<void> {
  const session = await getSession(sessionId, userId);
  if (!session) {
    throw new SessionServiceError(
      "Session not found",
      "SESSION_NOT_FOUND",
      sessionId
    );
  }

  // Kill the tmux session — plugin decides whether one exists. Plugins
  // that opt out of tmux (file viewer, browser) skip this entirely.
  if (sessionUsesTmux(session)) {
    await TmuxService.killSession(session.tmuxSessionName);
  }

  // Let the plugin clean up any type-specific resources (e.g. the browser
  // plugin closes its Playwright context here). Failures are logged but
  // must not block the close from completing.
  try {
    const plugin = TerminalTypeServerRegistry.get(session.terminalType);
    if (plugin?.onSessionClose) {
      await plugin.onSessionClose(session);
    }
  } catch (error) {
    log.error("Plugin onSessionClose hook failed", {
      sessionId,
      terminalType: session.terminalType,
      error: String(error),
    });
  }

  // Mark as closed in database
  await db
    .update(terminalSessions)
    .set({
      status: "closed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    );

  // Revoke agent-session API key so it can't be used after close
  try {
    await db.delete(apiKeys).where(
      and(eq(apiKeys.userId, userId), eq(apiKeys.name, `agent-session-${sessionId}`))
    );
  } catch (error) {
    log.error("Failed to revoke API key", { sessionId, error: String(error) });
  }

  // Clean up session-scoped gitconfig (non-profile sessions)
  try {
    await gitCredentialManager.cleanupSession(sessionId);
  } catch (error) {
    log.error("Failed to clean up session gitconfig", { sessionId, error: String(error) });
  }

  // Cancel open/in-progress agent tasks so they don't show as stale
  try {
    const { cancelOpenAgentTasks } = await import("@/services/task-service");
    await cancelOpenAgentTasks(sessionId, userId);
  } catch (error) {
    log.error("Failed to cancel agent tasks", { sessionId, error: String(error) });
  }
}

/**
 * Reorder sessions (update tabOrder for all sessions).
 * Uses a transaction to ensure atomicity - all sessions are reordered
 * or none are, preventing inconsistent tab order states.
 */
export async function reorderSessions(
  userId: string,
  sessionIds: string[]
): Promise<void> {
  await db.transaction(async (tx) => {
    // Update each session with its new order within transaction
    await Promise.all(
      sessionIds.map((id, index) =>
        tx
          .update(terminalSessions)
          .set({ tabOrder: index, updatedAt: new Date() })
          .where(
            and(
              eq(terminalSessions.id, id),
              eq(terminalSessions.userId, userId)
            )
          )
      )
    );
  });
}

// Helper to map database result to TypeScript type
export function mapDbSessionToSession(dbSession: typeof terminalSessions.$inferSelect): TerminalSession {
  return {
    id: dbSession.id,
    userId: dbSession.userId,
    name: dbSession.name,
    tmuxSessionName: dbSession.tmuxSessionName,
    projectPath: dbSession.projectPath,
    githubRepoId: dbSession.githubRepoId,
    worktreeBranch: dbSession.worktreeBranch,
    worktreeType: dbSession.worktreeType as WorktreeType | null,
    projectId: dbSession.projectId ?? null,
    profileId: dbSession.profileId,
    terminalType: dbSession.terminalType ?? "shell",
    agentProvider: dbSession.agentProvider as AgentProviderType | null,
    agentExitState: dbSession.agentExitState as TerminalSession["agentExitState"],
    agentExitCode: dbSession.agentExitCode ?? null,
    agentExitedAt: dbSession.agentExitedAt ? new Date(dbSession.agentExitedAt) : null,
    agentRestartCount: dbSession.agentRestartCount ?? 0,
    agentActivityStatus: dbSession.agentActivityStatus ?? null,
    typeMetadata: dbSession.typeMetadata ? JSON.parse(dbSession.typeMetadata) : null,
    scopeKey: dbSession.scopeKey ?? null,
    parentSessionId: dbSession.parentSessionId ?? null,
    status: dbSession.status as SessionStatus,
    pinned: dbSession.pinned ?? false,
    tabOrder: dbSession.tabOrder,
    lastActivityAt: new Date(dbSession.lastActivityAt),
    createdAt: new Date(dbSession.createdAt),
    updatedAt: new Date(dbSession.updatedAt),
  };
}

/**
 * Build the agent CLI command for auto-launch.
 *
 * @param customCommand - Optional folder startup command to use as base
 *   (e.g., `jclaude` wrapper). If it matches the provider's command name,
 *   the custom command is used instead.
 */
function buildAgentCommand(
  provider: AgentProviderType,
  flags?: string[],
  customCommand?: string
): string | null {
  const config = AGENT_PROVIDERS.find((p) => p.id === provider);
  if (!config || !config.command) {
    return null;
  }

  // Use the folder's startup command as the base if it's a simple command name
  // (e.g., "jclaude" wrapper for the "claude" provider). Only use it if it's
  // a single word (no flags/args) to avoid double-flag issues.
  const baseCommand =
    customCommand && !customCommand.includes(" ")
      ? customCommand
      : config.command;

  const allFlags = [...config.defaultFlags, ...(flags ?? [])];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${baseCommand}${flagsStr}`;
}

/**
 * Resolve all config directories where agent hooks/MCP config should be installed.
 * Includes the primary configDir plus any HOME override detected in the startup command.
 */
async function resolveAgentConfigDirs(
  configDir: string,
  startupCommand: string | undefined,
  sessionId: string
): Promise<Set<string>> {
  const dirs = new Set<string>([configDir]);
  if (!startupCommand) return dirs;

  try {
    const effectiveHome = await AgentProfileService.resolveEffectiveHome(startupCommand);
    if (effectiveHome) {
      log.debug("Detected HOME override", { sessionId, effectiveHome, configDir });
      dirs.add(effectiveHome);
    }
  } catch (error) {
    log.warn("Failed to resolve effective HOME", { sessionId, error: String(error) });
  }

  return dirs;
}

/**
 * Install agent activity hooks in the agent's config.
 * Used by both createSession and resumeSession to keep agent config current.
 * Failures are logged but do not block session creation/resume.
 * Installs to all provided config directories in parallel.
 */
async function ensureAgentConfig(
  configDirs: Set<string>,
  provider: Exclude<AgentProviderType, "none">,
  sessionId: string,
  rdvEnv?: Record<string, string>
): Promise<void> {
  if (provider !== "claude") return;

  await Promise.all(
    [...configDirs].map((dir) =>
      AgentProfileService.installAgentHooks(dir, provider, rdvEnv)
        .catch((e) => log.error("Failed to install agent hooks", { sessionId, dir, error: String(e) }))
    )
  );

  // Validate hooks if env vars are available (session creation path)
  if (rdvEnv && Object.keys(rdvEnv).length > 0) {
    const primaryDir = [...configDirs][0];
    if (primaryDir) {
      AgentProfileService.validateAgentHooks(primaryDir, provider, sessionId, rdvEnv)
        .then(async (result) => {
          if (!result.valid) {
            log.error("Hook validation failed", { sessionId, error: result.error });
            // Notify user that hooks may not work correctly
            try {
              const session = await db.query.terminalSessions.findFirst({
                where: eq(terminalSessions.id, sessionId),
                columns: { userId: true, name: true },
              });
              if (session) {
                const NotificationService = await import("@/services/notification-service");
                await NotificationService.createNotification({
                  userId: session.userId,
                  sessionId,
                  sessionName: session.name,
                  type: "agent_error",
                  title: "Agent hooks validation failed",
                  body: `Session "${session.name}" may not report status correctly. Try restarting the session.`,
                });
              }
            } catch (notifyErr) {
              log.warn("Failed to create hook validation notification", { error: String(notifyErr) });
            }
          } else if (result.repaired) {
            log.info("Hooks were auto-repaired", { sessionId });
          }
        })
        .catch((e) => log.error("Hook validation error", { sessionId, error: String(e) }));
    }
  }
}

/**
 * Create a worktree with standardized error handling and env file copying.
 * Wraps WorktreeService errors in SessionServiceError.
 */
async function createWorktreeWithErrorHandling(
  repoPath: string,
  branchName: string,
  baseBranch: string | undefined,
  sessionId: string
): Promise<{ worktreePath: string }> {
  try {
    const result = await WorktreeService.createBranchWithWorktree(
      repoPath,
      branchName,
      baseBranch,
      undefined // Auto-generate worktree path
    );

    // Copy .env files from main repo to worktree
    await WorktreeService.copyEnvFilesToWorktree(repoPath, result.worktreePath);

    return result;
  } catch (error) {
    if (error instanceof WorktreeService.WorktreeServiceError) {
      throw new SessionServiceError(
        `Failed to create worktree: ${error.message}`,
        error.code,
        sessionId
      );
    }
    throw error;
  }
}
