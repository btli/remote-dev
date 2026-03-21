/**
 * Agent Task Sync Service
 *
 * Syncs Claude Code's TaskCreate/TaskUpdate tool calls to remote-dev's project_task table.
 * Called by the /internal/agent-todos endpoint when PostToolUse hooks fire.
 *
 * Supports both new TaskCreate/TaskUpdate format (Claude Code v2.1.69+)
 * and legacy TodoWrite format.
 */

import * as TaskService from "./task-service";
import { parsePostToolUsePayload, type PostToolUsePayload } from "./agent-todo-sync-pure";
import { buildStopMessage, POST_TASK_MARKER_PREFIX, POST_TASK_CONFIG } from "./agent-stop-message";
import { createLogger } from "@/lib/logger";
import type { UpdateTaskInput, ProjectTask } from "@/types/task";

const log = createLogger("AgentTodoSync");

/** Legacy marker prefix for backward-compatible dedup (pre-agentTaskKey migration) */
const LEGACY_MARKER_PREFIX = "agent-task:";

/** Find the maximum sortOrder across a set of tasks (-1 if empty). */
function maxSortOrder(tasks: ProjectTask[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.sortOrder), -1);
}

/**
 * Extract agentTaskKey from a task, with fallback to legacy description marker.
 * This handles tasks created before the agentTaskKey column existed.
 */
function getAgentTaskKey(task: ProjectTask): string | undefined {
  if (task.agentTaskKey) return task.agentTaskKey;
  // Fallback: check for legacy marker in description
  if (task.description) {
    const firstLine = task.description.split("\n")[0];
    if (firstLine.startsWith(LEGACY_MARKER_PREFIX)) {
      return firstLine.replace(LEGACY_MARKER_PREFIX, "");
    }
  }
  return undefined;
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
  const session = await TaskService.getSessionContext(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const { userId, folderId } = session;

  // Get all tasks for this session (for sortOrder) and agent tasks (for dedup)
  const allSessionTasks = await TaskService.getAllTasksBySession(sessionId, userId);
  const agentTasks = allSessionTasks.filter((t) => t.source === "agent");

  // Build agentTaskKey lookup map for O(1) dedup
  const existingByKey = new Map<string, ProjectTask>();
  for (const task of agentTasks) {
    const key = getAgentTaskKey(task);
    if (key) {
      existingByKey.set(key, task);
    }
  }

  // Use max(sortOrder)+1 to avoid collisions from concurrent PostToolUse hooks
  // (allSessionTasks.length is racy — concurrent hooks may read the same value)
  const nextSort = maxSortOrder(allSessionTasks) + 1;

  let created = 0;
  let updated = 0;

  for (const op of ops) {
    if (op.type === "create") {
      const existingTask = existingByKey.get(op.agentTaskId);

      if (existingTask) {
        // Upsert: update if status, title, priority, or other fields changed
        const updates: UpdateTaskInput = {};
        if (existingTask.status !== op.status) updates.status = op.status;
        if (existingTask.title !== op.subject) updates.title = op.subject;
        if (op.priority && existingTask.priority !== op.priority) updates.priority = op.priority;
        if (op.description !== undefined && existingTask.description !== op.description) {
          updates.description = op.description;
        }
        if (op.metadata && typeof op.metadata === "object") updates.metadata = op.metadata;
        if (op.owner && existingTask.owner !== op.owner) updates.owner = op.owner;

        // Migrate legacy tasks: set agentTaskKey if missing
        if (!existingTask.agentTaskKey) {
          updates.agentTaskKey = op.agentTaskId;
        }

        if (Object.keys(updates).length > 0) {
          await TaskService.updateTask(existingTask.id, userId, updates);
          updated++;
        }
        continue;
      }

      const newTask = await TaskService.createTask(userId, {
        folderId,
        sessionId,
        title: op.subject,
        description: op.description ?? null,
        status: op.status,
        priority: op.priority,
        source: "agent",
        agentTaskKey: op.agentTaskId,
        metadata: op.metadata,
        owner: op.owner,
        sortOrder: nextSort + created,
      });

      // Handle blockedBy — resolve agent task IDs to DB task IDs
      if (op.blockedBy && op.blockedBy.length > 0) {
        const blockerDbIds = resolveAgentTaskIds(op.blockedBy, existingByKey, agentTasks);
        if (blockerDbIds.length > 0) {
          await TaskService.setDependencies(newTask.id, blockerDbIds);
        }
      }

      created++;
    } else if (op.type === "update") {
      // Match by agentTaskId — key-based first, position-based fallback
      let target: ProjectTask | undefined;

      // Try key-based lookup first (stable IDs)
      target = existingByKey.get(op.agentTaskId);

      // Fall back to position-based matching (legacy TodoWrite "1", "2", etc.)
      if (!target) {
        const taskIndex = parseInt(op.agentTaskId, 10) - 1;
        if (!isNaN(taskIndex) && taskIndex >= 0 && taskIndex < agentTasks.length) {
          target = agentTasks[taskIndex];
        }
      }

      if (target) {
        const updates: UpdateTaskInput = {};
        if (op.status) updates.status = op.status;
        if (op.subject) updates.title = op.subject;
        if (op.priority) updates.priority = op.priority;
        if (op.description !== undefined) updates.description = op.description;
        if (op.metadata && typeof op.metadata === "object") updates.metadata = op.metadata;
        if (op.owner) updates.owner = op.owner;

        if (Object.keys(updates).length > 0) {
          await TaskService.updateTask(target.id, userId, updates);
          updated++;
        }

        // Handle dependency updates
        if (op.blockedBy && op.blockedBy.length > 0) {
          const blockerDbIds = resolveAgentTaskIds(op.blockedBy, existingByKey, agentTasks);
          if (blockerDbIds.length > 0) {
            await TaskService.setDependencies(target.id, blockerDbIds);
          }
        }
      } else {
        log.warn("TaskUpdate target not found — update silently dropped", {
          agentTaskId: op.agentTaskId,
          existingKeys: [...existingByKey.keys()],
          agentTaskCount: agentTasks.length,
          sessionId,
        });
      }
    }
  }

  return { created, updated };
}

/**
 * Resolve agent-side task IDs (stable keys or sequential "1", "2")
 * to actual database task IDs.
 * Key-based lookup takes priority; position-based is legacy fallback only.
 */
function resolveAgentTaskIds(
  agentIds: string[],
  keyMap: Map<string, ProjectTask>,
  agentTasks: ProjectTask[]
): string[] {
  const dbIds: string[] = [];
  for (const agentId of agentIds) {
    // Try key-based lookup first via O(1) map
    const byKey = keyMap.get(agentId);
    if (byKey) {
      dbIds.push(byKey.id);
      continue;
    }
    // Fall back to position-based matching (legacy TodoWrite "1", "2", etc.)
    const index = parseInt(agentId, 10) - 1;
    if (!isNaN(index) && index >= 0 && index < agentTasks.length) {
      dbIds.push(agentTasks[index].id);
    }
  }
  return dbIds;
}

/** Post-task titles derived from the shared config (single source of truth) */
const POST_TASKS = POST_TASK_CONFIG.map((t) => t.title);

/**
 * Check agent tasks on stop and enforce completion.
 *
 * Called by the Stop hook endpoint. This function:
 * 1. Appends "Code Simplifier" and "Code Review" tasks if they don't exist yet
 * 2. Checks if all agent tasks (including the appended ones) are completed
 * 3. Returns null if all done (agent can stop), or a message listing
 *    incomplete tasks (agent should continue)
 *
 * Checks both agent-sourced and user-assigned tasks for the session.
 */
export async function checkTasksOnStop(
  sessionId: string
): Promise<string | null> {
  const session = await TaskService.getSessionContext(sessionId);
  if (!session) return null; // session not found, allow stop

  const { userId, folderId } = session;
  let tasks = await TaskService.getAllTasksBySession(sessionId, userId);

  // Append post-tasks if they don't already exist
  // Uses agentTaskKey-based dedup to prevent duplicates from concurrent stop hook invocations
  const nextSort = maxSortOrder(tasks) + 1;
  let postTasksCreated = 0;
  let created = false;
  for (let i = 0; i < POST_TASKS.length; i++) {
    const postTaskTitle = POST_TASKS[i];
    const postTaskKey = `${POST_TASK_MARKER_PREFIX}${postTaskTitle}`;
    const exists = tasks.some(
      (t) => t.agentTaskKey === postTaskKey ||
        // Fallback: check legacy description marker
        t.description?.startsWith(postTaskKey)
    );
    if (!exists) {
      await TaskService.createTask(userId, {
        folderId,
        sessionId,
        title: postTaskTitle,
        description: null,
        status: "open",
        priority: "low",
        source: "agent",
        agentTaskKey: postTaskKey,
        sortOrder: nextSort + postTasksCreated,
      });
      postTasksCreated++;
      created = true;
    }
  }

  // Re-fetch after creation to get authoritative list (handles race conditions
  // where concurrent calls may have also created post-tasks)
  if (created) {
    tasks = await TaskService.getAllTasksBySession(sessionId, userId);
  }

  // Deduplicate post-tasks by agentTaskKey (handles race-created dupes)
  const seenKeys = new Set<string>();
  const dedupedTasks = tasks.filter((t) => {
    if (!t.agentTaskKey?.startsWith(POST_TASK_MARKER_PREFIX)) return true;
    if (seenKeys.has(t.agentTaskKey)) return false;
    seenKeys.add(t.agentTaskKey);
    return true;
  });

  // Check for incomplete tasks (anything not done or cancelled)
  const incomplete = dedupedTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );

  if (incomplete.length === 0) return null; // all done, agent can stop

  return buildStopMessage(incomplete);
}

/**
 * Cancel incomplete agent tasks for a session.
 * Called when a session is closed. Sets open/in-progress tasks to
 * "cancelled" (since the agent is no longer running).
 * Leaves "done" tasks untouched to preserve their completed status.
 */
export async function archiveSessionTodos(
  sessionId: string,
  userId: string
): Promise<number> {
  return TaskService.cancelOpenAgentTasks(sessionId, userId);
}
