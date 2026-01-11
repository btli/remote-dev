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
import * as TmuxService from "./tmux-service";
import * as WorktreeService from "./worktree-service";
import * as GitHubService from "./github-service";
import * as AgentProfileService from "./agent-profile-service";
import { getResolvedPreferences, getFolderPreferences, getEnvironmentForSession } from "./preferences-service";
import { SessionServiceError } from "@/lib/errors";

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
  // Use custom tmux session name if provided (for orchestrators), otherwise generate
  const tmuxSessionName = input.tmuxSessionName || TmuxService.generateSessionName(sessionId);

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
    try {
      const result = await WorktreeService.createBranchWithWorktree(
        input.projectPath,
        sanitizedBranch,
        input.baseBranch,
        undefined // Auto-generate worktree path
      );
      workingPath = result.worktreePath;

      // Copy .env files from main repo to worktree
      WorktreeService.copyEnvFilesToWorktree(input.projectPath, result.worktreePath);
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
    try {
      const result = await WorktreeService.createBranchWithWorktree(
        repoPath,
        autoBranch,
        input.baseBranch,
        undefined // Auto-generate worktree path
      );
      workingPath = result.worktreePath;

      // Copy .env files from main repo to worktree
      WorktreeService.copyEnvFilesToWorktree(repoPath, result.worktreePath);

      // Update input for database record
      if (repoId) {
        input.githubRepoId = repoId;
      }
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

  // Determine session type and command approach:
  // - Agent sessions: Use native tmux command spawning (command runs as the session process)
  // - Terminal sessions: Start a plain shell, optionally with startupCommand injection
  const isAgentSession = input.agentProvider && input.agentProvider !== "none" && input.autoLaunchAgent;

  // Create the tmux session
  try {
    if (isAgentSession) {
      // Agent session: Use native command spawning
      // The agent CLI runs directly as the session process (no shell injection)
      const agentCommand = buildAgentCommand(input.agentProvider!, input.agentFlags);
      await TmuxService.createSession({
        sessionName: tmuxSessionName,
        cwd: workingPath ?? undefined,
        command: agentCommand || undefined,
        env: profileEnv,
        autoRespawn: input.isOrchestratorSession ?? false, // Orchestrators auto-respawn
      });
    } else {
      // Terminal session: Start a shell, optionally with startup command
      const startupCommand = input.startupCommand || preferences.startupCommand || undefined;
      await TmuxService.createSession(
        tmuxSessionName,
        workingPath ?? undefined,
        startupCommand,
        profileEnv,
        folderEnv ?? undefined
      );
    }
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
        agentProvider: input.agentProvider ?? "none",
        isOrchestratorSession: input.isOrchestratorSession ?? false,
        status: "active",
        tabOrder: nextTabOrder,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Store session context in working memory (non-blocking)
    import("./session-memory-service")
      .then(({ onSessionStart }) => {
        onSessionStart(
          userId,
          session.id,
          input.folderId ?? null,
          {
            projectPath: workingPath ?? undefined,
            workingDirectory: workingPath ?? undefined,
            startupCommand: input.startupCommand ?? undefined,
          }
        ).catch((err) => {
          console.warn("[SessionService] Failed to store session context:", err);
        });
      })
      .catch(() => {
        // Module load failed, ignore
      });

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

  // Promote valuable working memories to long-term before closing
  try {
    const { onSessionClose } = await import("./session-memory-service");
    const promoted = await onSessionClose(userId, sessionId);
    if (promoted > 0) {
      console.log(`[SessionService] Promoted ${promoted} memories to long-term for session ${sessionId}`);
    }
  } catch (error) {
    // Don't block session close on memory errors
    console.warn("[SessionService] Failed to promote session memories:", error);
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
    agentProvider: dbSession.agentProvider as AgentProviderType | null,
    isOrchestratorSession: dbSession.isOrchestratorSession,
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
