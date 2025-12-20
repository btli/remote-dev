/**
 * SessionService - Manages terminal session lifecycle and persistence
 */
import { db } from "@/db";
import { terminalSessions, githubRepositories } from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import type {
  TerminalSession,
  CreateSessionInput,
  UpdateSessionInput,
  SessionStatus,
  SessionWithMetadata,
} from "@/types/session";
import * as TmuxService from "./tmux-service";

export class SessionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "SessionServiceError";
  }
}

/**
 * Create a new terminal session
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
      eq(terminalSessions.status, "active")
    ),
    orderBy: [desc(terminalSessions.tabOrder)],
    limit: 1,
  });

  const nextTabOrder = existingSessions.length > 0
    ? existingSessions[0].tabOrder + 1
    : 0;

  // Create the tmux session first
  try {
    await TmuxService.createSession(
      tmuxSessionName,
      input.projectPath ?? process.env.HOME ?? undefined
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

  // Insert the database record
  const now = new Date();
  const [session] = await db
    .insert(terminalSessions)
    .values({
      id: sessionId,
      userId,
      name: input.name,
      tmuxSessionName,
      projectPath: input.projectPath ?? null,
      githubRepoId: input.githubRepoId ?? null,
      worktreeBranch: input.worktreeBranch ?? null,
      status: "active",
      tabOrder: nextTabOrder,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbSessionToSession(session);
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
  status?: SessionStatus
): Promise<TerminalSession[]> {
  const sessions = await db.query.terminalSessions.findMany({
    where: status
      ? and(
          eq(terminalSessions.userId, userId),
          eq(terminalSessions.status, status)
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
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Resume a suspended session
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
    .where(eq(terminalSessions.id, sessionId));
}

/**
 * Close a session (kill tmux, mark as closed)
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
    .where(eq(terminalSessions.id, sessionId));
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

/**
 * Recover sessions after server restart
 * Checks if tmux sessions still exist and updates status accordingly
 */
export async function recoverSessions(userId: string): Promise<{
  recovered: string[];
  lost: string[];
}> {
  const sessions = await listSessions(userId, "active");
  const recovered: string[] = [];
  const lost: string[] = [];

  for (const session of sessions) {
    const exists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (exists) {
      recovered.push(session.id);
    } else {
      // Mark as closed if tmux session is gone
      await db
        .update(terminalSessions)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(terminalSessions.id, session.id));
      lost.push(session.id);
    }
  }

  return { recovered, lost };
}

/**
 * Clean up orphaned tmux sessions that aren't in the database
 */
export async function cleanupOrphanedTmuxSessions(userId: string): Promise<string[]> {
  const sessions = await listSessions(userId);
  const validSessionNames = new Set(sessions.map((s) => s.tmuxSessionName));
  return TmuxService.cleanupOrphanedSessions(validSessionNames, "rdv-");
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
    status: dbSession.status as SessionStatus,
    tabOrder: dbSession.tabOrder,
    lastActivityAt: new Date(dbSession.lastActivityAt),
    createdAt: new Date(dbSession.createdAt),
    updatedAt: new Date(dbSession.updatedAt),
  };
}
