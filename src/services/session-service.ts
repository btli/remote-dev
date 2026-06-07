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

      // Singleton-scope sessions (GLOBAL_TERMINAL_TYPES — settings /
      // recordings / profiles) render in the sidebar's dedicated "Global"
      // section regardless of project_id, so we no longer rewrite the stored
      // project_id on dedup. The carrier project is an implementation detail
      // of the NOT NULL schema constraint and is ignored by the tree renderer
      // for these types. See remote-dev-cvtz.3 (Option C).
      return { session: mapDbSessionToSession(existingRow), reused: true };
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

  const isAgentTerminal = terminalType === "agent" || terminalType === "loop";

  // Pre-resolve folder/user preferences so we can layer in per-provider
  // agentProviderSettings below. The legacy folder-level `startupCommand`
  // wrapper mechanism was removed — there is no string-level override
  // threaded into plugins anymore.
  const earlyPreferences = input.projectId
    ? await getResolvedPreferences(userId, input.projectId)
    : null;

  // Resolve agent-provider settings (extra flags + allowDangerous) for
  // agent-type sessions. Two precedence rules, depending on the field:
  //
  //   • agentProvider — OVERRIDE semantics. Explicit input wins outright;
  //     falls back to folder default → user default → "claude".
  //   • allowDangerousFlags — OVERRIDE semantics. Explicit input wins;
  //     falls back to the resolved per-provider setting → false.
  //   • agentFlags — ACCUMULATE semantics. Caller flags AND preference
  //     `extraFlags` are concatenated (caller first). This is intentional
  //     so a New Session wizard can append a one-off flag without losing
  //     the user's configured defaults.
  //
  // Source of preference values: `earlyPreferences.agentProviderSettings`
  // already folds in both user-level and project-level settings (project
  // REPLACES user as a whole-object replace). The merge runs for both
  // "agent" and "loop" terminal types — both run an agent CLI as the tmux
  // shell process. Other terminal types pass through unchanged.
  let mergedAgentProvider = input.agentProvider;
  let mergedAgentFlags = input.agentFlags;
  let mergedAllowDangerous = input.allowDangerousFlags;
  if (terminalType === "agent" || terminalType === "loop") {
    const resolvedProvider: AgentProviderType =
      input.agentProvider ?? earlyPreferences?.defaultAgentProvider ?? "claude";
    mergedAgentProvider = resolvedProvider;

    const providerKey = resolvedProvider as Exclude<AgentProviderType, "none">;
    const effectiveSettings =
      earlyPreferences?.agentProviderSettings?.[providerKey] ?? undefined;
    if (effectiveSettings) {
      mergedAgentFlags = [
        ...(input.agentFlags ?? []),
        ...(effectiveSettings.extraFlags ?? []),
      ];
      // Caller's explicit allowDangerousFlags wins; otherwise use the
      // resolved per-provider setting.
      mergedAllowDangerous =
        input.allowDangerousFlags ?? effectiveSettings.allowDangerous ?? false;
    }
  }

  // Build a partial session stub for the plugin to introspect if needed.
  // Constructed AFTER the merge so the provider exposed to server plugins
  // matches what actually launches — `mergedAgentProvider` (input → folder/user
  // default → "claude"), not the raw (possibly absent) `input.agentProvider`.
  // The stub's only consumer is `plugin.createSession(pluginInput, …)` below,
  // which runs after this point. (remote-dev-u02r, codex finding 2)
  const pluginSessionStub: Partial<TerminalSession> = {
    id: sessionId,
    userId,
    name: input.name,
    projectId: input.projectId,
    profileId: input.profileId ?? null,
    terminalType,
    agentProvider: isAgentTerminal ? (mergedAgentProvider ?? "claude") : null,
  };

  // Pass to the plugin via a mutated input copy so agent-style plugins see
  // the merged provider/flags/allowDangerous. Non-agent plugins ignore the
  // agent fields. We deliberately mutate a shallow copy to avoid leaking
  // the merge result back onto caller state.
  const pluginInput: CreateSessionInput = {
    ...input,
    agentProvider: mergedAgentProvider,
    agentFlags: mergedAgentFlags,
    allowDangerousFlags: mergedAllowDangerous,
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
  // [hgwo] `mergedMetadata` is `let` so the durable resume binding (computed
  // later inside the plugin.useTmux block, once initialEnv is known) can be
  // folded in before the single typeMetadata column write at insert time.
  let mergedMetadata: Record<string, unknown> | null =
    pluginMetadata || input.typeMetadata
      ? { ...(pluginMetadata ?? {}), ...(input.typeMetadata ?? {}) }
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

  // Track the *actually used* worktree repo path + whether a worktree block
  // ran, so the DB-insert failure cleanup below doesn't depend on the client
  // sending `input.projectPath`. The folder-context block resolves the repo
  // path server-side (from folder preferences), so the old
  // `repoPath = input.projectPath` was null whenever the client omitted the
  // path — leaking the just-created worktree on insert failure.
  let resolvedWorktreeRepoPath: string | null = null;
  let didCreateWorktree = false;

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
    // Record the repo we created the worktree from (server-resolved, not
    // necessarily input.projectPath) so failure cleanup can remove it.
    resolvedWorktreeRepoPath = repoPath;
    didCreateWorktree = true;

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
    resolvedWorktreeRepoPath = input.projectPath;
    didCreateWorktree = true;
  }

  // The startup command (when shell-typed plugins still want one) defaults
  // to the autoLaunchAgent-built command below, otherwise undefined. There
  // is no folder-level wrapper override — provider.command is canonical.
  let startupCommand: string | undefined;

  // Handle agent-aware session: auto-launch the agent CLI. The command is
  // derived entirely from the provider + merged flags; per-provider
  // `allowDangerous` setting controls dangerous-flag filtering.
  //
  // Uses `mergedAgentProvider` (input → folder default → user default →
  // "claude" for agent/loop types) rather than the raw `input.agentProvider`
  // for consistency/robustness, NOT to fix production behavior: this
  // `startupCommand` only reaches tmux when a plugin returns
  // `shellCommand: null` (effective command is
  // `sessionConfig.shellCommand ?? startupCommand`), and the built-in
  // agent/loop plugins always return a non-null `shellCommand` built from the
  // already-merged `pluginInput.agentProvider`. So for current callers this
  // block is inert; the merged provider just keeps a `shellCommand: null`
  // plugin (e.g. a future or test plugin) consistent with the merge. For
  // shell-type sessions the merge is a no-op
  // (`mergedAgentProvider === input.agentProvider`).
  //
  // SECURITY: reads from `pluginInput.agentFlags` (the merged flags) — NOT
  // `input.agentFlags` — so the per-provider preference flags are honored
  // and the dangerous-flag filter (inside the local `buildAgentCommand`)
  // sees the same flags the agent plugin would.
  if (mergedAgentProvider && mergedAgentProvider !== "none" && input.autoLaunchAgent) {
    // For loop sessions with Claude, add --output-format stream-json for structured output parsing
    const agentFlags = [...(pluginInput.agentFlags ?? [])];
    if (input.terminalType === "loop" && mergedAgentProvider === "claude" && !agentFlags.includes("--output-format")) {
      agentFlags.push("--output-format", "stream-json");
    }
    const agentCommand = buildAgentCommand(
      mergedAgentProvider,
      agentFlags,
      mergedAllowDangerous,
    );
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

  // Determine session role early — drives env-var injection and the
  // tmux pane-exited hook below.
  //
  // `isAgentRuntime` — narrow flag: true ONLY when the tmux pane is actually
  //   running an AI coding agent (Claude/Codex/Gemini/OpenCode). Gates the
  //   agent-specific side effects: API key creation, RDV env vars,
  //   `ensureAgentConfig` settings.json injection, proxy env, claude defaults.
  //
  // `isAgentSession` — wider flag: true when the plugin opts into the agent-
  //   style exit-screen / restart UX via `emitsExitEvents`. Currently agent /
  //   loop / ssh. Used solely to (a) initialize `agentExitState = "running"`
  //   on the DB row and (b) install the tmux `pane-exited` hook so the
  //   client can render an exit screen with a Restart button.
  //
  // Splitting the two flags prevents agent-only side effects (like writing
  // hooks into `~/.claude/settings.json`) from leaking into SSH sessions.
  const emitsExitEvents =
    TerminalTypeServerRegistry.get(terminalType)?.emitsExitEvents ?? false;
  // First clause uses `mergedAgentProvider` for consistency with
  // `effectiveAgentProvider` below. This is semantically identical to reading
  // `input.agentProvider` here: for agent/loop the `terminalType` clauses
  // already force `true`, and for every other terminal type
  // `mergedAgentProvider === input.agentProvider` (it's only reassigned inside
  // the agent/loop merge branch).
  const isAgentRuntime =
    (mergedAgentProvider && mergedAgentProvider !== "none" && input.autoLaunchAgent) ||
    input.terminalType === "agent" ||
    input.terminalType === "loop";
  const isAgentSession = isAgentRuntime || emitsExitEvents;
  // Derive the effective provider from the MERGED resolution, not raw
  // `input.agentProvider`. For agent/loop sessions where the client omitted a
  // provider, `mergedAgentProvider` folded in the folder/user default (→ "claude"
  // as last resort), which is the provider that actually launches (plugin
  // command) and is written to the DB row. Keying the durable resume binding,
  // model-proxy scope, and claude-defaults gate off this — rather than off the
  // raw input — keeps "what we recorded" in sync with "what we launched". For
  // non-agent/loop types `mergedAgentProvider === input.agentProvider`, so this
  // is semantics-preserving there. (remote-dev-u02r)
  const effectiveAgentProvider = mergedAgentProvider && mergedAgentProvider !== "none"
    ? mergedAgentProvider
    : "claude"; // Default matches DB default on line ~350

  // RDV env vars for agent hook callbacks (session ID + terminal server address)
  // Socket mode (prod): uses TERMINAL_SOCKET; Port mode (dev): uses TERMINAL_PORT
  const terminalSocket = process.env.TERMINAL_SOCKET;
  log.debug("Session creation details", {
    sessionId,
    isAgentRuntime: !!isAgentRuntime,
    isAgentSession: !!isAgentSession,
    provider: effectiveAgentProvider,
    terminalType: input.terminalType,
  });
  // Auto-create API key for agent runtimes so they can make authenticated API
  // calls back to the API server (e.g. /internal/peers/*, /internal/tasks/*).
  // Gated on isAgentRuntime — SSH sessions don't run agent hook scripts and
  // would never use the key.
  let agentApiKey: string | undefined;
  if (isAgentRuntime) {
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

  // [aehq] Centralized model-key proxy (feature-flagged OFF by default). When
  // on, mint a per-session proxy token and point the agent CLI at the in-Next.js
  // proxy with the token in place of a real provider key. Merged into initialEnv
  // AFTER proxyEnv (LiteLLM) so it overrides it. When the flag is off this is
  // empty and behavior is byte-identical to today.
  let modelProxyEnv: Record<string, string> = {};
  if (isAgentRuntime && process.env.RDV_MODEL_PROXY_ENABLED === "1") {
    try {
      const { issueProxyToken } = await import("@/services/model-proxy-token-service");
      const { buildModelProxyEnv, providerScopeFor } = await import("@/lib/env-keys");
      const { INSTANCE_SLUG } = await import("@/lib/base-path");
      const { token } = await issueProxyToken({
        userId,
        sessionId,
        instanceSlug: INSTANCE_SLUG || undefined,
        providerScope: providerScopeFor(effectiveAgentProvider),
      });
      // The proxy lives on the API server; agents reach it on the local API
      // port (or localhost when bound to a unix socket).
      const apiBase = process.env.SOCKET_PATH
        ? "http://localhost"
        : `http://localhost:${process.env.PORT ?? "6001"}`;
      modelProxyEnv = buildModelProxyEnv(effectiveAgentProvider, token, apiBase);
    } catch (error) {
      log.error("Failed to mint model-proxy token", { sessionId, error: String(error) });
    }
  }

  // RDV_* env vars only matter to local agent hook scripts that call back
  // into the terminal/API server. SSH sessions don't run those hooks (the
  // remote shell wouldn't see the vars anyway), so skip injecting them.
  const rdvEnv: Record<string, string> = isAgentRuntime
    ? {
        RDV_SESSION_ID: sessionId,
        ...(terminalSocket
          ? { RDV_TERMINAL_SOCKET: terminalSocket }
          : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "6002" }),
        ...(process.env.SOCKET_PATH
          ? { RDV_API_SOCKET: process.env.SOCKET_PATH }
          : { RDV_API_PORT: process.env.PORT ?? "6001" }),
        ...(agentApiKey ? { RDV_API_KEY: agentApiKey } : {}),
      }
    : {};

  // Install agent hooks and MCP config BEFORE tmux session creation so the
  // agent picks them up at startup (Claude Code reads settings once on launch).
  // Gated on isAgentRuntime — only AI agent sessions read these settings;
  // SSH/loop-without-provider sessions would otherwise pollute settings.json
  // with hooks that never fire.
  if (isAgentRuntime) {
    const configDir = profile?.configDir ?? process.env.HOME;
    if (configDir) {
      // Previously this also sniffed `startupCommand` for an inline `HOME=`
      // override (e.g. `HOME=/foo claude`) so hooks could be installed in
      // the wrapped HOME directory. That path is gone with `startupCommand`
      // — wrapper aliases install their own configs.
      await ensureAgentConfig(new Set([configDir]), effectiveAgentProvider, sessionId, rdvEnv);
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

  // LiteLLM proxy env is only relevant when the tmux pane is running an AI
  // agent CLI — SSH sessions should not have ANTHROPIC_BASE_URL etc. forced
  // into their remote shell environment.
  const proxyEnv = isAgentRuntime
    ? await resolveProxyEnv(effectiveAgentProvider, userId)
    : {};

  // The plugin decides whether tmux is needed via its declarative
  // `useTmux` flag. File/browser sessions opt out — no shell command,
  // no PTY. `SessionConfig.useTmux` is kept in lock-step for callers
  // that still read from the returned config.
  if (plugin.useTmux) {
    const gitCredentialEnv = await resolveGitCredentialEnv(sessionId, !!profile);
    const folderGitIdentityEnv = await resolveFolderGitIdentityEnv(userId, input.projectId);

    // Claude Code agent defaults (lowest precedence — overridable via profile/folder env).
    // Gated on isAgentRuntime so SSH sessions don't get CLAUDE_CODE_* env vars they
    // don't need.
    const claudeAgentDefaults: Record<string, string> = isAgentRuntime && effectiveAgentProvider === "claude" && terminalType !== "loop"
      ? { CLAUDE_CODE_NO_FLICKER: "1" }
      : {};

    // Initial environment — all must be present at PTY spawn so agent processes inherit them immediately.
    // Precedence (low → high): claudeAgentDefaults < pluginEnv < profileEnv < proxyEnv < modelProxyEnv
    //   < folderEnv < folderGitIdentityEnv < gitCredentialEnv < ghAccountEnv < rdvEnv.
    const initialEnv: Record<string, string> = {
      ...claudeAgentDefaults,
      ...(sessionConfig.environment ?? {}),
      ...(profileEnv ?? {}),
      ...proxyEnv,
      ...modelProxyEnv, // [aehq] proxy token + base URL win over LiteLLM (proxyEnv) + profile
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

    // [hgwo] Persist a durable resume binding for agent sessions: the sanitized
    // env (secrets stripped) + provider + initial flags. The native session id
    // is captured later (hgwo.1); this binding's job is to record the env +
    // provider durably so a recreate (terminal-server / pod restart) can
    // relaunch the agent — and resume the conversation via disk discovery —
    // even before any id was captured. Rides along into the same typeMetadata
    // column write below (no extra UPDATE, no new column).
    if (isAgentSession && effectiveAgentProvider) {
      try {
        const { buildResumeBinding } = await import("@/lib/agent-resume/resume-binding");
        const binding = buildResumeBinding(
          {
            provider: effectiveAgentProvider,
            resumeFlags: mergedAgentFlags ?? [],
            argvOverride: null,
          },
          initialEnv,
        );
        mergedMetadata = { ...(mergedMetadata ?? {}), resumeBinding: binding };
      } catch (error) {
        log.error("Failed to build resume binding", { sessionId, error: String(error) });
      }
    }

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

  // Track if we created a worktree so we can clean it up on failure. Both
  // values are set inside the worktree blocks above (folder-context:
  // server-resolved from folder preferences; explicit-path: the validated
  // input.projectPath), so cleanup no longer silently skips when the client
  // omits projectPath.
  const createdWorktree = didCreateWorktree && branchName;
  const repoPath = resolvedWorktreeRepoPath;

  // `terminalType`, `plugin` were resolved up-front; see the dedup +
  // plugin-delegation block near the top of createSession. [hgwo] The
  // typeMetadata JSON is serialized HERE (deferred from the assembly block) so
  // the resume binding folded into mergedMetadata inside the useTmux block is
  // included in the single column write.
  const typeMetadata: string | null = mergedMetadata
    ? JSON.stringify(mergedMetadata)
    : null;

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
        agentProvider: isAgentTerminal ? (mergedAgentProvider ?? "claude") : null,
        // Initialize the agent-style exit-state machine for any plugin that
        // opts into the exit-screen / restart UX (agent / loop / ssh today).
        // Driven by the plugin registry capability flag, not hardcoded types.
        agentExitState: emitsExitEvents ? "running" : null,
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

    // Claim the project's registered ports for this live session. The runtime
    // port-proxy data-plane reads these claims to decide which ports are
    // reachable. Best-effort: claiming must NEVER fail or block session
    // creation, so the whole thing is wrapped and only logged on failure.
    // Dynamic imports avoid an import cycle — session-service is heavily
    // imported, and the port services transitively pull it back in.
    if (input.projectId) {
      try {
        const { getPortsForFolder } = await import(
          "./port-registry-service"
        );
        const regPorts = await getPortsForFolder(input.projectId, userId);
        if (regPorts.length > 0) {
          const { claimPortsForSession } = await import(
            "./port-claims-service"
          );
          await claimPortsForSession(
            sessionId,
            userId,
            input.projectId,
            regPorts.map((p) => ({
              port: p.port,
              variableName: p.variableName,
            }))
          );
        }
      } catch (error) {
        log.warn("Failed to claim ports for session", {
          sessionId,
          projectId: input.projectId,
          error: String(error),
        });
      }
    }

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
        // losing-side INSERT — the winner already owns its own. Mirrors the
        // generic cleanup block below (same guard + .catch + log.error, run
        // concurrently) so the race-recovery return path doesn't leak a
        // worktree the loser may have created. Currently unreachable in
        // practice (createWorktree sessions don't combine with scopeKey dedup),
        // but hardened to stay correct if they ever do. (remote-dev-u02r)
        //
        // SAFETY (codex finding 1): in a `scopeKey + createWorktree` race, the
        // loser can be handed the WINNER's worktree path — `createBranchWithWorktree`
        // in worktree-service reuses an existing valid worktree when `git worktree
        // add` fails and the target path is already a git repo (see "If the target
        // path already exists as a valid git worktree, reuse it", ~line 466-471).
        // Force-removing that path would destroy the winner's ACTIVE worktree, so
        // skip removal when the winner row already points at the same path. The
        // session row stores the working path in `projectPath` (DB insert:
        // `projectPath: workingPath ?? null`).
        const raceCleanup: Promise<void>[] = [
          TmuxService.killSession(tmuxSessionName).catch(() => {
            log.error("Failed to clean up orphaned tmux after race", {
              tmuxSessionName,
            });
          }),
        ];
        if (
          createdWorktree &&
          repoPath &&
          workingPath &&
          existingAfterRace[0].projectPath !== workingPath
        ) {
          raceCleanup.push(
            WorktreeService.removeWorktree(repoPath, workingPath, true)
              .then(() => {}) // Discard result to match Promise<void> type
              .catch(() => {
                log.error("Failed to clean up orphaned worktree after race", {
                  worktreePath: workingPath,
                });
              })
          );
        }
        await Promise.all(raceCleanup);
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

  // Null out scope_key whenever the session transitions to closed or trashed
  // so the partial UNIQUE index on (user_id, terminal_type, scope_key) frees
  // the slot for a future create-session call with the same scope. Applies
  // regardless of whether the caller explicitly set scopeKey in the patch.
  const isBecomingInactive =
    (updates.status === "closed" || updates.status === "trashed") &&
    existing.status !== updates.status;
  const directUpdatesWithScope = directUpdates as typeof directUpdates & {
    scopeKey?: string | null;
  };
  if (isBecomingInactive && directUpdatesWithScope.scopeKey === undefined) {
    directUpdatesWithScope.scopeKey = null;
  }
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
      // [remote-dev-1aa5] Stamp arrival time so a late stale hook write (older
      // statusAt) can't overwrite this authoritative lifecycle transition.
      agentActivityStatusAt: now.getTime(),
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
      agentActivityStatusAt: now.getTime(),
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
      agentActivityStatusAt: now.getTime(),
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
      agentActivityStatusAt: now.getTime(),
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

  // Audit trail for lifecycle transitions (smwq): one INFO line per suspend so
  // status debugging has a record of who/when. State changes are info-level.
  log.info("Session suspended", {
    sessionId,
    name: session.name,
    trigger: "suspendSession",
  });

  // [aehq] Revoke the session's model-proxy tokens while suspended — the agent
  // is detached and resume re-mints a fresh token. Idempotent (revokes 0 rows
  // when none exist) and a no-op when the proxy was never enabled (empty table),
  // so it stays byte-identical for non-proxy deployments.
  try {
    const { revokeTokensForSession } = await import("./model-proxy-token-service");
    await revokeTokensForSession(sessionId);
  } catch (error) {
    log.error("Failed to revoke model-proxy tokens on suspend", { sessionId, error: String(error) });
  }
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
    log.info("Session resumed", {
      sessionId,
      name: session.name,
      trigger: "resumeSession",
    });
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

      // [aehq] Re-mint a fresh model-proxy token on resume (feature-flagged OFF
      // by default; empty + byte-identical to today when off). The predecessor
      // token is revoked FIRST so tokens never accumulate across suspend/resume
      // cycles — only one valid token per session at a time (blast radius = one
      // session, revocable).
      let modelProxyEnv: Record<string, string> = {};
      if (process.env.RDV_MODEL_PROXY_ENABLED === "1" && agentProvider !== "none") {
        try {
          const { issueProxyToken, revokeTokensForSession } = await import(
            "@/services/model-proxy-token-service"
          );
          const { buildModelProxyEnv, providerScopeFor } = await import("@/lib/env-keys");
          const { INSTANCE_SLUG } = await import("@/lib/base-path");
          // Idempotent + safe even if no prior token exists (revokes 0 rows).
          await revokeTokensForSession(sessionId);
          const { token } = await issueProxyToken({
            userId,
            sessionId,
            instanceSlug: INSTANCE_SLUG || undefined,
            providerScope: providerScopeFor(agentProvider),
          });
          const apiBase = process.env.SOCKET_PATH
            ? "http://localhost"
            : `http://localhost:${process.env.PORT ?? "6001"}`;
          modelProxyEnv = buildModelProxyEnv(agentProvider, token, apiBase);
        } catch (error) {
          log.error("Failed to mint model-proxy token on resume", { sessionId, error: String(error) });
        }
      }

      await TmuxService.setSessionEnvironment(session.tmuxSessionName, {
        ...proxyEnv,
        ...modelProxyEnv, // [aehq] proxy token + base URL win over LiteLLM (proxyEnv)
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

  // Audit trail for lifecycle transitions (smwq): one INFO line per resume.
  log.info("Session resumed", {
    sessionId,
    name: session.name,
    trigger: "resumeSession",
  });
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

  // Mark as closed in database. Null out scope_key at the same time so the
  // partial UNIQUE index on (user_id, terminal_type, scope_key) frees the
  // slot for a future create-session call with the same scope. Without this,
  // the next "Open Settings" (or recordings/profiles) would fail the UNIQUE
  // constraint because dedup skips closed rows but the index does not.
  await db
    .update(terminalSessions)
    .set({
      status: "closed",
      scopeKey: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      )
    );

  // Release runtime port claims held by this session. closeSession only marks
  // status=closed (it does not delete the row), so the FK cascade never fires
  // here — this explicit release is what actually frees the claimed ports.
  try {
    const { releasePortsForSession } = await import("./port-claims-service");
    await releasePortsForSession(sessionId);
  } catch (error) {
    log.error("Failed to release port claims", {
      sessionId,
      error: String(error),
    });
  }

  // Revoke agent-session API key so it can't be used after close
  try {
    await db.delete(apiKeys).where(
      and(eq(apiKeys.userId, userId), eq(apiKeys.name, `agent-session-${sessionId}`))
    );
  } catch (error) {
    log.error("Failed to revoke API key", { sessionId, error: String(error) });
  }

  // [aehq] Revoke any model-proxy tokens scoped to this session so the agent's
  // proxy credential dies with the session (the FK cascade is a delete-path
  // backstop; this explicit revoke also covers suspend-without-delete). No-op
  // when the model proxy was never enabled — the table is simply empty.
  try {
    const { revokeTokensForSession } = await import("./model-proxy-token-service");
    await revokeTokensForSession(sessionId);
  } catch (error) {
    log.error("Failed to revoke model-proxy tokens", { sessionId, error: String(error) });
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
    agentActivityStatusAt: dbSession.agentActivityStatusAt ?? null,
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
 * Build the agent CLI command for auto-launch. The base command is always
 * `config.command` — the folder-level wrapper override mechanism was
 * removed; use shell aliases instead.
 *
 * @param allowDangerous - When false (default), flags listed in
 *   `provider.dangerousFlags` are filtered out before composition. Mirrors
 *   the agent-utils `buildAgentCommand` semantics so the autoLaunchAgent
 *   code path can't silently bypass the safety guard.
 */
function buildAgentCommand(
  provider: AgentProviderType,
  flags?: string[],
  allowDangerous = false,
): string | null {
  const config = AGENT_PROVIDERS.find((p) => p.id === provider);
  if (!config || !config.command) {
    return null;
  }

  // SECURITY: filter dangerous flags unless explicitly allowed. Matches the
  // shared `buildAgentCommand` in `agent-utils.ts` so both code paths apply
  // the same guard.
  const safeFlags = allowDangerous
    ? flags ?? []
    : (flags ?? []).filter((f) => !config.dangerousFlags?.includes(f));

  const allFlags = [...config.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${config.command}${flagsStr}`;
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
