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

  // Handle worktree creation for feature sessions (with explicit path + description)
  if (input.createWorktree && input.projectPath && input.featureDescription) {
    // Generate branch name from feature description
    const sanitizedBranch = `feature/${WorktreeService.sanitizeBranchName(input.featureDescription)}`;
    branchName = sanitizedBranch;

    // Validate it's a git repo
    if (!(await WorktreeService.isGitRepo(input.projectPath))) {
      throw new SessionServiceError(
        "Project path is not a git repository",
        "NOT_GIT_REPO",
        sessionId
      );
    }

    // Create the worktree with new branch
    const result = await createWorktreeWithErrorHandling(
      input.projectPath,
      sanitizedBranch,
      input.baseBranch,
      sessionId
    );
    workingPath = result.worktreePath;
  }

  // Handle quick worktree creation from folder (New Worktree menu item)
  if (input.createWorktree && input.folderId && !input.featureDescription) {
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

    // Generate auto branch name with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const autoBranch = `wt-${timestamp}`;
    branchName = autoBranch;

    // Create the worktree with new branch
    const result = await createWorktreeWithErrorHandling(
      repoPath,
      autoBranch,
      input.baseBranch,
      sessionId
    );
    workingPath = result.worktreePath;

    // Update input for database record
    if (repoId) {
      input.githubRepoId = repoId;
    }
  }

  // Determine startup command (explicit override takes precedence)
  let startupCommand = input.startupCommand || preferences.startupCommand || undefined;

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

  // Fetch profile environment overlay if profile is specified
  let profileEnv: Record<string, string> | undefined;
  if (input.profileId) {
    const env = await AgentProfileService.getProfileEnvironment(input.profileId, userId);
    if (env) {
      // Filter out undefined values to get a clean Record<string, string>
      profileEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );
    }
  }

  // Fetch folder environment variables to inject into the shell
  const folderEnv = await getEnvironmentForSession(userId, input.folderId);

  // Create the tmux session with profile environment and folder shell environment
  try {
    await TmuxService.createSession(
      tmuxSessionName,
      workingPath ?? undefined,
      startupCommand,
      profileEnv,
      folderEnv ?? undefined
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
        folderId: input.folderId ?? null,
        profileId: input.profileId ?? null,
        terminalType,
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

  // Check if tmux session still exists
  const exists = await TmuxService.sessionExists(session.tmuxSessionName);
  if (!exists) {
    throw new SessionServiceError(
      "Tmux session no longer exists",
      "TMUX_SESSION_GONE",
      sessionId
    );
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

  // Kill the tmux session
  await TmuxService.killSession(session.tmuxSessionName);

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
    folderId: dbSession.folderId,
    profileId: dbSession.profileId,
    terminalType: dbSession.terminalType ?? "shell",
    agentProvider: dbSession.agentProvider as AgentProviderType | null,
    agentExitState: dbSession.agentExitState as TerminalSession["agentExitState"],
    agentExitCode: dbSession.agentExitCode ?? null,
    agentExitedAt: dbSession.agentExitedAt ? new Date(dbSession.agentExitedAt) : null,
    agentRestartCount: dbSession.agentRestartCount ?? 0,
    typeMetadata: dbSession.typeMetadata ? JSON.parse(dbSession.typeMetadata) : null,
    splitGroupId: dbSession.splitGroupId,
    splitOrder: dbSession.splitOrder,
    splitSize: dbSession.splitSize ?? 0.5,
    status: dbSession.status as SessionStatus,
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
