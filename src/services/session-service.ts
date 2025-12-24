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
} from "@/types/session";
import * as TmuxService from "./tmux-service";
import * as WorktreeService from "./worktree-service";
import * as GitHubService from "./github-service";
import { getResolvedPreferences, getFolderPreferences } from "./preferences-service";
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
    try {
      const result = await WorktreeService.createBranchWithWorktree(
        input.projectPath,
        sanitizedBranch,
        input.baseBranch,
        undefined // Auto-generate worktree path
      );
      workingPath = result.worktreePath;
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

    if (folderPrefs?.githubRepoId) {
      // Get repo from database
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
    } else if (folderPrefs?.localRepoPath) {
      repoPath = folderPrefs.localRepoPath;
    }

    if (!repoPath) {
      throw new SessionServiceError(
        "No repository linked to this folder. Configure in folder preferences.",
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

  // Determine startup command (explicit override takes precedence)
  const startupCommand = input.startupCommand || preferences.startupCommand || undefined;

  // Create the tmux session
  try {
    await TmuxService.createSession(
      tmuxSessionName,
      workingPath ?? undefined,
      startupCommand
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

  // Insert the database record - clean up tmux session if this fails
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
        status: "active",
        tabOrder: nextTabOrder,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return mapDbSessionToSession(session);
  } catch (error) {
    // SECURITY: Clean up orphaned tmux session if DB insert fails
    await TmuxService.killSession(tmuxSessionName).catch(() => {
      console.error(`Failed to clean up orphaned tmux session: ${tmuxSessionName}`);
    });
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
 * Reorder sessions (update tabOrder for all sessions)
 */
export async function reorderSessions(
  userId: string,
  sessionIds: string[]
): Promise<void> {
  // Update each session with its new order
  await Promise.all(
    sessionIds.map((id, index) =>
      db
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
