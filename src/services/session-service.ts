/**
 * SessionService - Manages terminal session lifecycle and persistence
 */
import { db } from "@/db";
import { terminalSessions, githubRepositories } from "@/db/schema";
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
import { getResolvedPreferences, getFolderPreferences, getEnvironmentForSession } from "./preferences-service";
import { SessionServiceError } from "@/lib/errors";
import { TerminalTypeRegistry } from "@/lib/terminal-plugins/registry";
import { initializeBuiltInPlugins } from "@/lib/terminal-plugins/init";
import { githubAccountRepository } from "@/infrastructure/container";
import { GitHubAccountEnvironment } from "@/domain/value-objects/GitHubAccountEnvironment";
import { archiveSessionTodos } from "./agent-todo-sync";

// Initialize plugins on module load
initializeBuiltInPlugins();

// Re-export for backwards compatibility with API routes
export { SessionServiceError };

/**
 * Create a new terminal session.
 * SECURITY: Wraps tmux creation with proper cleanup on DB failure.
 */
export async function createSession(
  userId: string,
  input: CreateSessionInput
): Promise<TerminalSession> {
  const sessionId = crypto.randomUUID();
  const tmuxSessionName = TmuxService.generateSessionName(sessionId);

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

  // Fetch resolved preferences
  const preferences = await getResolvedPreferences(userId, input.folderId);

  // Determine working path and branch name
  let workingPath = input.projectPath ?? preferences.defaultWorkingDirectory ?? process.env.HOME;
  let branchName = input.worktreeBranch;

  // Handle worktree creation from folder context (resolves repo from folder preferences)
  if (input.createWorktree && input.folderId) {
    // Get folder preferences to find linked repository
    const folderPrefs = await getFolderPreferences(input.folderId, userId);

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
  if (input.createWorktree && !input.folderId && input.projectPath && !branchName) {
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
  // If startupCommand is explicitly provided (even as empty string), use it; otherwise use preferences
  let startupCommand =
    input.startupCommand !== undefined
      ? input.startupCommand || undefined
      : preferences.startupCommand || undefined;

  // Handle agent-aware session: auto-launch the agent CLI
  if (input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent) {
    const agentCommand = buildAgentCommand(input.agentProvider, input.agentFlags);
    if (agentCommand) {
      // If there's already a startup command, chain them
      startupCommand = startupCommand
        ? `${startupCommand} && ${agentCommand}`
        : agentCommand;
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
  const folderEnv = await getEnvironmentForSession(userId, input.folderId);

  // Determine if this is an agent session early — needed for env var injection
  // Check both explicit agent flags AND terminalType (profiles set terminalType
  // but may not send agentProvider/autoLaunchAgent separately)
  const isAgentSession =
    (input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent) ||
    input.terminalType === "agent";
  const effectiveAgentProvider = input.agentProvider && input.agentProvider !== "none"
    ? input.agentProvider
    : "claude"; // Default matches DB default on line ~350

  // RDV env vars for agent hook callbacks (session ID + terminal server address)
  // Socket mode (prod): uses TERMINAL_SOCKET; Port mode (dev): uses TERMINAL_PORT
  const terminalSocket = process.env.TERMINAL_SOCKET;
  console.log(`[session:${sessionId}] isAgentSession=${!!isAgentSession} provider=${effectiveAgentProvider} terminalType=${input.terminalType} TERMINAL_PORT=${process.env.TERMINAL_PORT}`);
  const rdvEnv: Record<string, string> = isAgentSession
    ? {
        RDV_SESSION_ID: sessionId,
        ...(terminalSocket
          ? { RDV_TERMINAL_SOCKET: terminalSocket }
          : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "3001" }),
      }
    : {};

  // Install agent hooks and MCP config BEFORE tmux session creation so the
  // agent picks them up at startup (Claude Code reads settings once on launch)
  if (isAgentSession) {
    const configDir = profile?.configDir ?? process.env.HOME;
    if (configDir) {
      const configDirs = await resolveAgentConfigDirs(configDir, startupCommand, sessionId);
      await ensureAgentConfig(configDirs, effectiveAgentProvider, userId, sessionId, workingPath);
    }
  }

  // Resolve GitHub account environment for the session's folder binding
  // This MUST happen before tmux session creation so agent processes inherit it at spawn
  let ghAccountEnv: Record<string, string> | null = null;
  try {
    // Find the GitHub account bound to this folder (or fall back to default)
    const account = input.folderId
      ? await githubAccountRepository.findByFolder(input.folderId, userId)
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
    console.error(`[session:${sessionId}] Failed to resolve GitHub account env:`, error);
  }

  // File-type sessions don't need tmux — they're pure UI (CodeMirror editor)
  if (input.terminalType !== "file") {
    // Initial environment: profile env + folder env + GitHub account env + RDV vars
    // All must be present at PTY spawn so agent processes inherit them immediately
    // Precedence: profileEnv < folderEnv < ghAccountEnv < rdvEnv
    // Bound GitHub account identity intentionally overrides folder-level env
    // (e.g., user-set GH_TOKEN in folder prefs is superseded by the account binding)
    const initialEnv: Record<string, string> = {
      ...(profileEnv ?? {}),
      ...(folderEnv ?? {}),
      ...(ghAccountEnv ?? {}),
      ...rdvEnv,
    };
    console.log(`[session:${sessionId}] initialEnv keys: [${Object.keys(initialEnv).join(', ')}]`);

    // Create the tmux session with initial environment for PTY spawn
    try {
      await TmuxService.createSession(
        tmuxSessionName,
        workingPath ?? undefined,
        startupCommand,
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
        console.error(
          `Failed to set session environment for ${tmuxSessionName}:`,
          error
        );
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
        console.error(
          `Failed to set agent exit hook for ${tmuxSessionName}:`,
          error
        );
      }
    }
  }

  // Track if we created a worktree so we can clean it up on failure
  const createdWorktree = input.createWorktree && branchName && workingPath !== input.projectPath;
  const repoPath = input.projectPath;

  // Determine terminal type from input
  // Priority: explicit terminalType > agent type (if autoLaunch) > shell
  let terminalType: TerminalType = input.terminalType ?? "shell";
  if (!input.terminalType && input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent) {
    terminalType = "agent";
  }

  // Get plugin for validation (optional - plugins can validate input)
  const plugin = TerminalTypeRegistry.get(terminalType);
  if (plugin?.validateInput) {
    const validationError = plugin.validateInput(input);
    if (validationError) {
      throw new SessionServiceError(validationError, "VALIDATION_ERROR", sessionId);
    }
  }

  // Build typeMetadata for file-type sessions
  let typeMetadata: string | null = null;
  if (terminalType === "file" && input.filePath) {
    const fileName = input.filePath.split("/").pop() ?? input.filePath;
    typeMetadata = JSON.stringify({ filePath: input.filePath, fileName });
  }

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
        folderId: input.folderId ?? null,
        profileId: input.profileId ?? null,
        terminalType,
        typeMetadata,
        agentProvider: input.agentProvider ?? "claude",
        // Set agent state for agent terminal type
        agentExitState: terminalType === "agent" ? "running" : null,
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

    return mapDbSessionToSession(session);
  } catch (error) {
    // SECURITY: Clean up orphaned resources if DB insert fails
    const cleanupPromises: Promise<void>[] = [
      // Clean up orphaned tmux session
      TmuxService.killSession(tmuxSessionName).catch(() => {
        console.error(`Failed to clean up orphaned tmux session: ${tmuxSessionName}`);
      }),
    ];

    // Clean up orphaned worktree if we created one
    if (createdWorktree && repoPath && workingPath) {
      cleanupPromises.push(
        WorktreeService.removeWorktree(repoPath, workingPath, true)
          .then(() => {}) // Discard result to match Promise<void> type
          .catch(() => {
            console.error(`Failed to clean up orphaned worktree: ${workingPath}`);
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
  status?: SessionStatus | SessionStatus[]
): Promise<TerminalSession[]> {
  const statusFilter = Array.isArray(status) ? status : status ? [status] : null;
  const sessions = await db.query.terminalSessions.findMany({
    where: statusFilter && statusFilter.length > 0
      ? and(
          eq(terminalSessions.userId, userId),
          inArray(terminalSessions.status, statusFilter)
        )
      : eq(terminalSessions.userId, userId),
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
      console.error(`Failed to kill tmux session during status update: ${err.message}`);
    });
  }

  const [updated] = await db
    .update(terminalSessions)
    .set({
      ...updates,
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
// Agent State Management (for agent terminal type)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark agent as exited with exit code.
 * Called by terminal server when it detects the agent process has exited.
 */
export async function markAgentExited(
  sessionId: string,
  userId: string,
  exitCode: number | null
): Promise<TerminalSession | null> {
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
        eq(terminalSessions.userId, userId),
        eq(terminalSessions.terminalType, "agent")
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Mark agent as restarting (user clicked restart).
 * Increments restart count.
 */
export async function markAgentRestarting(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
  const session = await getSession(sessionId, userId);
  if (!session || session.terminalType !== "agent") {
    return null;
  }

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
 * Clears exit code and exit time.
 */
export async function markAgentRunning(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
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
        eq(terminalSessions.userId, userId),
        eq(terminalSessions.terminalType, "agent")
      )
    )
    .returning();

  return updated ? mapDbSessionToSession(updated) : null;
}

/**
 * Mark agent session as closed (won't be restarted).
 * Called when user chooses to close instead of restart.
 */
export async function markAgentClosed(
  sessionId: string,
  userId: string
): Promise<TerminalSession | null> {
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
        eq(terminalSessions.userId, userId),
        eq(terminalSessions.terminalType, "agent")
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

  // File-type sessions have no tmux session — nothing to resume
  if (session.terminalType === "file") {
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

  // For agent sessions, ensure hooks, MCP config, and env vars are up to date on resume.
  // This handles upgrades (e.g., hook format changes) and sessions created
  // before hooks/MCP were installed.
  if (session.terminalType === "agent") {
    const agentProvider = (session.agentProvider ?? "claude") as AgentProviderType;
    const configDir = session.profileId
      ? (await AgentProfileService.getProfile(session.profileId, userId))?.configDir
      : process.env.HOME;

    if (configDir && agentProvider !== "none") {
      // On resume, hooks were installed at create time — just refresh the primary configDir
      await ensureAgentConfig(new Set([configDir]), agentProvider, userId, sessionId, session.projectPath);
    }

    // Refresh RDV + GitHub account env vars on resume (may be missing on older
    // sessions, or stale if the folder's account binding or OAuth token changed)
    try {
      const terminalSocket = process.env.TERMINAL_SOCKET;
      const rdvEnv: Record<string, string> = {
        RDV_SESSION_ID: sessionId,
        ...(terminalSocket
          ? { RDV_TERMINAL_SOCKET: terminalSocket }
          : { RDV_TERMINAL_PORT: process.env.TERMINAL_PORT ?? "3001" }),
      };

      let ghAccountEnv: Record<string, string> = {};
      try {
        const account = session.folderId
          ? await githubAccountRepository.findByFolder(session.folderId, userId)
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
        console.error(`[session:${sessionId}] Failed to resolve GitHub account env on resume:`, error);
      }

      await TmuxService.setSessionEnvironment(session.tmuxSessionName, { ...ghAccountEnv, ...rdvEnv });
    } catch (error) {
      console.error(`[session:${sessionId}] Failed to set env on resume:`, error);
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

  // Kill the tmux session (file-type sessions have no tmux session)
  if (session.terminalType !== "file") {
    await TmuxService.killSession(session.tmuxSessionName);
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

  // Auto-archive completed agent tasks for this session
  try {
    await archiveSessionTodos(sessionId, userId);
  } catch (error) {
    console.error(`[Session:${sessionId}] Failed to archive agent tasks:`, error);
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
function mapDbSessionToSession(dbSession: typeof terminalSessions.$inferSelect): TerminalSession {
  return {
    id: dbSession.id,
    userId: dbSession.userId,
    name: dbSession.name,
    tmuxSessionName: dbSession.tmuxSessionName,
    projectPath: dbSession.projectPath,
    githubRepoId: dbSession.githubRepoId,
    worktreeBranch: dbSession.worktreeBranch,
    worktreeType: dbSession.worktreeType as WorktreeType | null,
    folderId: dbSession.folderId,
    profileId: dbSession.profileId,
    terminalType: dbSession.terminalType ?? "shell",
    agentProvider: dbSession.agentProvider as AgentProviderType | null,
    agentExitState: dbSession.agentExitState as TerminalSession["agentExitState"],
    agentExitCode: dbSession.agentExitCode ?? null,
    agentExitedAt: dbSession.agentExitedAt ? new Date(dbSession.agentExitedAt) : null,
    agentRestartCount: dbSession.agentRestartCount ?? 0,
    agentActivityStatus: dbSession.agentActivityStatus ?? null,
    typeMetadata: dbSession.typeMetadata ? JSON.parse(dbSession.typeMetadata) : null,
    splitGroupId: dbSession.splitGroupId,
    splitOrder: dbSession.splitOrder,
    splitSize: dbSession.splitSize ?? 0.5,
    status: dbSession.status as SessionStatus,
    pinned: dbSession.pinned ?? false,
    tabOrder: dbSession.tabOrder,
    lastActivityAt: new Date(dbSession.lastActivityAt),
    createdAt: new Date(dbSession.createdAt),
    updatedAt: new Date(dbSession.updatedAt),
  };
}

/**
 * Build the agent CLI command for auto-launch
 */
function buildAgentCommand(provider: AgentProviderType, flags?: string[]): string | null {
  const config = AGENT_PROVIDERS.find((p) => p.id === provider);
  if (!config || !config.command) {
    return null;
  }

  const allFlags = [...config.defaultFlags, ...(flags ?? [])];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${config.command}${flagsStr}`;
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
      console.log(`[session:${sessionId}] Detected HOME override: ${effectiveHome} (configDir: ${configDir})`);
      dirs.add(effectiveHome);
    }
  } catch (error) {
    console.warn(`[session:${sessionId}] Failed to resolve effective HOME:`, error);
  }

  return dirs;
}

/**
 * Install agent activity hooks and register the MCP server in the agent's config.
 * Used by both createSession and resumeSession to keep agent config current.
 * Failures are logged but do not block session creation/resume.
 * Installs to all provided config directories in parallel.
 *
 * If projectDir is provided, also writes .mcp.json there so Claude Code
 * discovers the remote-dev MCP server from the project root (the primary
 * discovery path for project-scoped MCP servers).
 */
async function ensureAgentConfig(
  configDirs: Set<string>,
  provider: Exclude<AgentProviderType, "none">,
  userId: string,
  sessionId: string,
  projectDir?: string | null
): Promise<void> {
  const tasks = [...configDirs].flatMap((dir) => [
    ...(provider === "claude"
      ? [AgentProfileService.installAgentHooks(dir, provider)
          .catch((e) => console.error(`[session:${sessionId}] Failed to install agent hooks at ${dir}:`, e))]
      : []),
    AgentProfileService.registerMCPServer(dir, provider, userId)
      .catch((e) => console.error(`[session:${sessionId}] Failed to register MCP server at ${dir}:`, e)),
  ]);

  // Also register in .mcp.json at the project root (Claude Code's primary MCP discovery path)
  if (projectDir && provider === "claude") {
    tasks.push(
      AgentProfileService.registerMCPInProjectDir(projectDir, userId)
        .catch((e) => console.error(`[session:${sessionId}] Failed to register MCP in project .mcp.json at ${projectDir}:`, e))
    );
  }

  await Promise.all(tasks);
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
    WorktreeService.copyEnvFilesToWorktree(repoPath, result.worktreePath);

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
