/**
 * OrchestratorService - Manages parent-child orchestration relationships
 *
 * Handles spawning child agent sessions under a parent orchestrator,
 * querying child sessions, and building orchestration trees.
 */
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as SessionService from "./session-service";
import { mapDbSessionToSession } from "./session-service";
import type { TerminalSession, CreateSessionInput } from "@/types/session";

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}

/**
 * Spawn a child session under a parent orchestrator
 */
export async function spawnChildSession(
  userId: string,
  parentSessionId: string,
  input: Partial<CreateSessionInput> & {
    folderId?: string;
    agentProvider?: string;
    name?: string;
  }
): Promise<TerminalSession> {
  // 1. Validate parent exists and belongs to user
  const parent = await SessionService.getSession(parentSessionId, userId);
  if (!parent) {
    throw new OrchestratorError(
      "Parent session not found",
      "PARENT_NOT_FOUND"
    );
  }

  // 2. Validate parent is an orchestrator
  if (
    parent.orchestratorRole !== "parent" &&
    parent.terminalType !== "orchestrator"
  ) {
    throw new OrchestratorError(
      "Session is not an orchestrator",
      "NOT_ORCHESTRATOR"
    );
  }

  // 3. Create child session
  const childInput: CreateSessionInput = {
    name: input.name ?? `${parent.name} - Worker`,
    projectPath: input.projectPath ?? parent.projectPath ?? undefined,
    folderId: input.folderId ?? parent.folderId ?? undefined,
    terminalType: "agent",
    agentProvider:
      (input.agentProvider as CreateSessionInput["agentProvider"]) ??
      parent.agentProvider ??
      "claude",
    autoLaunchAgent: true,
    parentSessionId: parentSessionId,
  };

  return SessionService.createSession(userId, childInput);
}

/**
 * Get child sessions for a parent orchestrator.
 *
 * SessionService.listSessions does not support parentSessionId filtering,
 * so we query the database directly.
 */
export async function getChildSessions(
  userId: string,
  parentSessionId: string
): Promise<TerminalSession[]> {
  const rows = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.parentSessionId, parentSessionId)
    ),
  });

  return rows.map(mapDbSessionToSession);
}

/**
 * Get the full orchestration tree (parent + all children)
 */
export async function getOrchestrationTree(
  userId: string,
  sessionId: string
): Promise<{ parent: TerminalSession; children: TerminalSession[] } | null> {
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return null;

  // If this is a child, find the parent
  const parentId =
    session.orchestratorRole === "child"
      ? session.parentSessionId
      : session.id;
  if (!parentId) return null;

  const parent =
    session.orchestratorRole === "child"
      ? await SessionService.getSession(parentId, userId)
      : session;
  if (!parent) return null;

  const children = await getChildSessions(userId, parentId);
  return { parent, children };
}
