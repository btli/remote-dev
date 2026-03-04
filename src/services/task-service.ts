import { db } from "@/db";
import { projectTasks } from "@/db/schema";
import { eq, and, desc, asc, isNull } from "drizzle-orm";
import type {
  ProjectTask,
  CreateTaskInput,
  UpdateTaskInput,
  TaskLabel,
  TaskSubtask,
  TaskStatus,
} from "@/types/task";
import { safeJsonParse } from "@/lib/utils";

/**
 * Parse a raw DB row into a ProjectTask with JSON fields decoded.
 */
function parseTaskRow(row: typeof projectTasks.$inferSelect): ProjectTask {
  return {
    id: row.id,
    userId: row.userId,
    folderId: row.folderId,
    sessionId: row.sessionId ?? null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    source: row.source,
    labels: safeJsonParse<TaskLabel[]>(row.labels, []),
    subtasks: safeJsonParse<TaskSubtask[]>(row.subtasks, []),
    dueDate: row.dueDate,
    githubIssueUrl: row.githubIssueUrl,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get all tasks for a user, optionally filtered by folder and/or status.
 */
export async function getTasks(
  userId: string,
  folderId?: string | null,
  status?: TaskStatus
): Promise<ProjectTask[]> {
  const conditions = [eq(projectTasks.userId, userId)];

  if (folderId !== undefined) {
    if (folderId === null) {
      conditions.push(isNull(projectTasks.folderId));
    } else {
      conditions.push(eq(projectTasks.folderId, folderId));
    }
  }

  if (status) {
    conditions.push(eq(projectTasks.status, status));
  }

  const results = await db
    .select()
    .from(projectTasks)
    .where(and(...conditions))
    .orderBy(asc(projectTasks.sortOrder), desc(projectTasks.createdAt));

  return results.map(parseTaskRow);
}

/**
 * Get a single task by ID.
 */
export async function getTask(
  taskId: string,
  userId: string
): Promise<ProjectTask | null> {
  const results = await db
    .select()
    .from(projectTasks)
    .where(
      and(eq(projectTasks.id, taskId), eq(projectTasks.userId, userId))
    );

  return results[0] ? parseTaskRow(results[0]) : null;
}

/**
 * Create a new task.
 */
export async function createTask(
  userId: string,
  input: CreateTaskInput
): Promise<ProjectTask> {
  const [row] = await db
    .insert(projectTasks)
    .values({
      userId,
      folderId: input.folderId ?? null,
      sessionId: input.sessionId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "open",
      priority: input.priority ?? "medium",
      source: input.source ?? "manual",
      labels: JSON.stringify(input.labels ?? []),
      subtasks: JSON.stringify(input.subtasks ?? []),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      githubIssueUrl: input.githubIssueUrl ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  return parseTaskRow(row);
}

/**
 * Update an existing task.
 */
export async function updateTask(
  taskId: string,
  userId: string,
  input: UpdateTaskInput
): Promise<ProjectTask | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.labels !== undefined) updates.labels = JSON.stringify(input.labels);
  if (input.subtasks !== undefined)
    updates.subtasks = JSON.stringify(input.subtasks);
  if (input.dueDate !== undefined)
    updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.githubIssueUrl !== undefined)
    updates.githubIssueUrl = input.githubIssueUrl;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  const results = await db
    .update(projectTasks)
    .set(updates)
    .where(
      and(eq(projectTasks.id, taskId), eq(projectTasks.userId, userId))
    )
    .returning();

  return results[0] ? parseTaskRow(results[0]) : null;
}

/**
 * Delete a task.
 */
export async function deleteTask(
  taskId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(projectTasks)
    .where(
      and(eq(projectTasks.id, taskId), eq(projectTasks.userId, userId))
    )
    .returning({ id: projectTasks.id });

  return result.length > 0;
}

// Re-export from pure module for backward compatibility
export { mapTodoWriteStatus } from "./agent-todo-sync-pure";

/** Get all agent tasks for a specific session */
export async function getTasksBySession(
  sessionId: string,
  userId: string
): Promise<ProjectTask[]> {
  const rows = await db
    .select()
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.sessionId, sessionId),
        eq(projectTasks.userId, userId),
        eq(projectTasks.source, "agent")
      )
    )
    .orderBy(asc(projectTasks.sortOrder), desc(projectTasks.createdAt));
  return rows.map(parseTaskRow);
}
