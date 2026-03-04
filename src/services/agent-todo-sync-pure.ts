/**
 * Pure functions for agent TodoWrite sync (no DB dependencies).
 *
 * Extracted to allow testing in happy-dom environment which cannot
 * resolve node: built-in modules required by the DB layer.
 */

import type { ProjectTask, TaskStatus } from "@/types/task";

/** A single todo item from Claude Code's TodoWrite tool_input */
export interface TodoWriteItem {
  id: string;
  task: string;
  status: string;
}

/** Sync plan: what to create, update, and cancel */
export interface TodoSyncPlan {
  toCreate: Array<{ todoId: string; title: string; status: TaskStatus; sortOrder: number }>;
  toUpdate: Array<{ taskId: string; status: TaskStatus; title: string }>;
  toCancel: string[]; // task IDs to cancel
}

/** Map Claude Code TodoWrite status to remote-dev TaskStatus */
export function mapTodoWriteStatus(status: string): TaskStatus {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "completed":
      return "done";
    case "pending":
    default:
      return "open";
  }
}

/**
 * Build a sync plan by diffing incoming todos against existing tasks.
 *
 * Matching is done by the TodoWrite item ID stored in the task description
 * field as "TodoWrite #<id>".
 */
export function buildTodoSyncPlan(
  incoming: TodoWriteItem[],
  existing: ProjectTask[]
): TodoSyncPlan {
  const plan: TodoSyncPlan = {
    toCreate: [],
    toUpdate: [],
    toCancel: [],
  };

  // Build lookup: TodoWrite ID → existing task
  const existingByTodoId = new Map<string, ProjectTask>();
  for (const task of existing) {
    const match = task.description?.match(/^TodoWrite #(.+)$/);
    if (match) {
      existingByTodoId.set(match[1], task);
    }
  }

  // Track which existing tasks are still in the incoming list
  const seenTodoIds = new Set<string>();

  for (let i = 0; i < incoming.length; i++) {
    const todo = incoming[i];
    seenTodoIds.add(todo.id);
    const mappedStatus = mapTodoWriteStatus(todo.status);
    const existingTask = existingByTodoId.get(todo.id);

    if (!existingTask) {
      // New todo — create task
      plan.toCreate.push({
        todoId: todo.id,
        title: todo.task,
        status: mappedStatus,
        sortOrder: i,
      });
    } else if (existingTask.status !== mappedStatus || existingTask.title !== todo.task) {
      // Status or title changed — update
      plan.toUpdate.push({
        taskId: existingTask.id,
        status: mappedStatus,
        title: todo.task,
      });
    }
    // else: no change, skip
  }

  // Cancel tasks whose TodoWrite ID is no longer in the incoming list
  for (const [, task] of existingByTodoId) {
    if (!seenTodoIds.has(task.description?.match(/^TodoWrite #(.+)$/)?.[1] ?? "") &&
        task.status !== "cancelled" && task.status !== "done") {
      plan.toCancel.push(task.id);
    }
  }

  return plan;
}
