/**
 * Agent TodoWrite Sync Service
 *
 * Syncs Claude Code's TodoWrite task list to remote-dev's project_task table.
 * Called by the /internal/agent-todos endpoint when PostToolUse hooks fire.
 */

import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as TaskService from "./task-service";
import { buildTodoSyncPlan, type TodoWriteItem } from "./agent-todo-sync-pure";

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

/**
 * Sync TodoWrite tasks for a session.
 *
 * Parses the PostToolUse hook payload, diffs against existing tasks,
 * and applies creates/updates/cancellations.
 */
export async function syncAgentTodos(
  sessionId: string,
  payload: { tool_input?: { todos?: TodoWriteItem[] } }
): Promise<{ created: number; updated: number; cancelled: number }> {
  const todos = payload.tool_input?.todos;
  if (!todos || !Array.isArray(todos)) {
    return { created: 0, updated: 0, cancelled: 0 };
  }

  // Look up session to get userId and folderId
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const { userId, folderId } = session;

  // Get existing agent tasks for this session
  const existing = await TaskService.getTasksBySession(sessionId, userId);

  // Build sync plan
  const plan = buildTodoSyncPlan(todos, existing);

  // Execute plan
  for (const item of plan.toCreate) {
    await TaskService.createTask(userId, {
      folderId,
      sessionId,
      title: item.title,
      description: `TodoWrite #${item.todoId}`,
      status: item.status,
      source: "agent",
      sortOrder: item.sortOrder,
    });
  }

  for (const item of plan.toUpdate) {
    await TaskService.updateTask(item.taskId, userId, {
      status: item.status,
      title: item.title,
    });
  }

  for (const taskId of plan.toCancel) {
    await TaskService.updateTask(taskId, userId, {
      status: "cancelled",
    });
  }

  return {
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    cancelled: plan.toCancel.length,
  };
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
