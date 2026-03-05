/**
 * Agent Task Sync Service
 *
 * Syncs Claude Code's TaskCreate/TaskUpdate tool calls to remote-dev's project_task table.
 * Called by the /internal/agent-todos endpoint when PostToolUse hooks fire.
 *
 * Supports both new TaskCreate/TaskUpdate format (Claude Code v2.1.69+)
 * and legacy TodoWrite format.
 */

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as TaskService from "./task-service";
import { parsePostToolUsePayload, type PostToolUsePayload } from "./agent-todo-sync-pure";
import type { TaskStatus } from "@/types/task";

const MARKER_PREFIX = "agent-task:";

/**
 * Look up a session by ID (without requiring userId).
 * Used by the internal endpoint which only has sessionId from the hook.
 */
async function getSessionById(sessionId: string) {
  const rows = await db
    .select({
      id: terminalSessions.id,
      userId: terminalSessions.userId,
      folderId: terminalSessions.folderId,
    })
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Extract the agent-task marker from a task description, if present */
function extractMarker(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  const line = description.split("\n")[0];
  return line.startsWith(MARKER_PREFIX) ? line : undefined;
}

/**
 * Sync a single PostToolUse event for a session.
 *
 * Parses the PostToolUse hook payload, determines the operation type,
 * and applies creates/updates to the task table.
 */
export async function syncAgentTodos(
  sessionId: string,
  payload: PostToolUsePayload
): Promise<{ created: number; updated: number }> {
  const ops = parsePostToolUsePayload(payload);
  if (ops.length === 0) {
    return { created: 0, updated: 0 };
  }

  // Look up session to get userId and folderId
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const { userId, folderId } = session;

  // Get existing agent tasks for this session (for dedup/matching)
  const existing = await TaskService.getTasksBySession(sessionId, userId);
  const agentTasks = existing.filter((t) => t.source === "agent");

  // Build marker set for O(1) dedup lookups
  const existingMarkers = new Set<string>();
  const existingByMarker = new Map<string, (typeof existing)[0]>();
  for (const task of existing) {
    const marker = extractMarker(task.description);
    if (marker) {
      existingMarkers.add(marker);
      existingByMarker.set(marker, task);
    }
  }

  let created = 0;
  let updated = 0;

  for (const op of ops) {
    if (op.type === "create") {
      const marker = `${MARKER_PREFIX}${op.agentTaskId}`;
      const existingTask = existingByMarker.get(marker);

      if (existingTask) {
        // Upsert: update if status or title changed
        const needsUpdate =
          existingTask.status !== op.status ||
          existingTask.title !== op.subject;
        if (needsUpdate) {
          await TaskService.updateTask(existingTask.id, userId, {
            status: op.status,
            title: op.subject,
          });
          updated++;
        }
        continue;
      }

      await TaskService.createTask(userId, {
        folderId,
        sessionId,
        title: op.subject,
        description: op.description
          ? `${marker}\n${op.description}`
          : marker,
        status: op.status,
        source: "agent",
        sortOrder: existing.length + created,
      });
      created++;
    } else if (op.type === "update") {
      // For TaskUpdate, agentTaskId is the sequential ID ("1", "2", etc.)
      // We match by position in the session's agent task list (sorted by creation order)
      const taskIndex = parseInt(op.agentTaskId, 10) - 1; // "1" → index 0

      if (!isNaN(taskIndex) && taskIndex >= 0 && taskIndex < agentTasks.length) {
        const target = agentTasks[taskIndex];
        if (op.status || op.subject) {
          const updates: { status?: TaskStatus; title?: string } = {};
          if (op.status) updates.status = op.status;
          if (op.subject) updates.title = op.subject;
          await TaskService.updateTask(target.id, userId, updates);
          updated++;
        }
      }
    }
  }

  return { created, updated };
}

/**
 * Archive non-terminal agent tasks for a session.
 * Called when a session is closed. Cancels tasks that are still
 * open or in-progress (since the agent is no longer running).
 * Leaves "done" tasks untouched to preserve their completed status.
 */
export async function archiveSessionTodos(
  sessionId: string,
  userId: string
): Promise<number> {
  const tasks = await TaskService.getTasksBySession(sessionId, userId);
  let archived = 0;

  for (const task of tasks) {
    if (task.status === "open" || task.status === "in_progress") {
      await TaskService.updateTask(task.id, userId, {
        status: "cancelled",
      });
      archived++;
    }
  }

  return archived;
}
