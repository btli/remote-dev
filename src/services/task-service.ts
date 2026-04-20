import { db, client } from "@/db";
import { projectTasks, taskDependencies, terminalSessions } from "@/db/schema";
import { eq, and, asc, isNull, inArray } from "drizzle-orm";
import { translateFolderIdToProjectId } from "@/services/project-scope-util";
import type {
  ProjectTask,
  CreateTaskInput,
  UpdateTaskInput,
  TaskLabel,
  TaskSubtask,
  TaskSource,
  TaskStatus,
} from "@/types/task";
import { safeJsonParse } from "@/lib/utils";

/**
 * Parse a raw DB row into a ProjectTask with JSON fields decoded.
 * blockedBy is set to empty array — callers that need it should use
 * getTasks / getTask (which call loadDependencyMap) or populate it separately.
 */
function parseTaskRow(row: typeof projectTasks.$inferSelect): ProjectTask {
  return {
    id: row.id,
    userId: row.userId,
    folderId: row.folderId,
    projectId: row.projectId ?? null,
    sessionId: row.sessionId ?? null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    source: row.source,
    labels: safeJsonParse<TaskLabel[]>(row.labels, []),
    subtasks: safeJsonParse<TaskSubtask[]>(row.subtasks, []),
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    instructions: row.instructions ?? null,
    agentTaskKey: row.agentTaskKey ?? null,
    owner: row.owner ?? null,
    dueDate: row.dueDate,
    githubIssueUrl: row.githubIssueUrl,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    blockedBy: [],
  };
}

/**
 * Look up session context (userId, folderId) by session ID.
 * Used by internal endpoints that only have sessionId from hooks.
 */
export async function getSessionContext(sessionId: string) {
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
 * Batch-load dependency maps for a set of task IDs.
 * Returns a Map from blockedId → array of blockerId strings.
 */
async function loadDependencyMap(
  taskIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;

  const deps = await db
    .select()
    .from(taskDependencies)
    .where(inArray(taskDependencies.blockedId, taskIds));

  for (const dep of deps) {
    const existing = map.get(dep.blockedId);
    if (existing) {
      existing.push(dep.blockerId);
    } else {
      map.set(dep.blockedId, [dep.blockerId]);
    }
  }
  return map;
}

/**
 * Get all tasks for a user, optionally filtered by folder and/or status.
 * Includes blockedBy dependency data.
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
    .orderBy(asc(projectTasks.sortOrder), asc(projectTasks.createdAt));

  const tasks = results.map(parseTaskRow);
  const depMap = await loadDependencyMap(tasks.map((t) => t.id));
  for (const task of tasks) {
    task.blockedBy = depMap.get(task.id) ?? [];
  }
  return tasks;
}

/**
 * List all tasks under a project/group node. When `node.type === "group"`,
 * walks all descendant groups via a recursive CTE and rolls up projects that
 * belong to any of them. All filtering happens in SQL to avoid blowing past
 * SQLite's 32k bind-parameter limit on deep hierarchies.
 */
export async function listTasksByNode(
  node: { id: string; type: "group" | "project" },
  userId: string
): Promise<ProjectTask[]> {
  const rowsRaw =
    node.type === "project"
      ? await client.execute({
          sql: `SELECT * FROM project_task
                WHERE project_id = ? AND user_id = ?
                ORDER BY sort_order ASC, created_at ASC`,
          args: [node.id, userId],
        })
      : await client.execute({
          sql: `
            WITH RECURSIVE descendants(id, depth) AS (
              SELECT id, 0 FROM project_group WHERE id = ?
              UNION
              SELECT pg.id, d.depth + 1 FROM project_group pg
                JOIN descendants d ON pg.parent_group_id = d.id
                WHERE d.depth < 128
            )
            SELECT t.*
            FROM project_task t
            WHERE t.user_id = ?
              AND EXISTS (
                SELECT 1 FROM project p
                WHERE p.id = t.project_id
                  AND p.group_id IN (SELECT id FROM descendants)
              )
            ORDER BY t.sort_order ASC, t.created_at ASC
          `,
          args: [node.id, userId],
        });

  // Convert raw rows to the Drizzle select shape expected by parseTaskRow.
  const tasks = rowsRaw.rows.map((r) =>
    parseTaskRow({
      id: r.id as string,
      userId: r.user_id as string,
      folderId: (r.folder_id as string | null) ?? null,
      projectId: (r.project_id as string | null) ?? null,
      sessionId: (r.session_id as string | null) ?? null,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      status: r.status as TaskStatus,
      priority: (r.priority as ProjectTask["priority"]),
      source: (r.source as TaskSource) ?? "manual",
      labels: (r.labels as string) ?? "[]",
      subtasks: (r.subtasks as string) ?? "[]",
      metadata: (r.metadata as string) ?? "{}",
      instructions: (r.instructions as string | null) ?? null,
      agentTaskKey: (r.agent_task_key as string | null) ?? null,
      owner: (r.owner as string | null) ?? null,
      dueDate: r.due_date ? new Date(Number(r.due_date)) : null,
      githubIssueUrl: (r.github_issue_url as string | null) ?? null,
      sortOrder: Number(r.sort_order ?? 0),
      createdAt: new Date(Number(r.created_at)),
      updatedAt: new Date(Number(r.updated_at)),
    } as typeof projectTasks.$inferSelect)
  );
  const depMap = await loadDependencyMap(tasks.map((t) => t.id));
  for (const task of tasks) {
    task.blockedBy = depMap.get(task.id) ?? [];
  }
  return tasks;
}

/**
 * Get a single task by ID, including dependencies.
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

  if (!results[0]) return null;
  const task = parseTaskRow(results[0]);
  const depMap = await loadDependencyMap([task.id]);
  task.blockedBy = depMap.get(task.id) ?? [];
  return task;
}

/**
 * Get a task's userId by task ID (no auth check).
 * Used by internal endpoints that need to resolve ownership.
 */
export async function getTaskOwner(
  taskId: string
): Promise<{ userId: string; sessionId: string | null } | null> {
  const rows = await db
    .select({
      userId: projectTasks.userId,
      sessionId: projectTasks.sessionId,
    })
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create a new task.
 */
export async function createTask(
  userId: string,
  input: CreateTaskInput
): Promise<ProjectTask> {
  // Dual-write Phase 3: populate projectId alongside folderId.
  const resolvedProjectId =
    input.projectId ??
    (input.folderId
      ? await translateFolderIdToProjectId(input.folderId, userId)
      : null);
  if (!resolvedProjectId) {
    throw new Error("createTask: projectId is required (no folderId→projectId mapping found)");
  }
  const [row] = await db
    .insert(projectTasks)
    .values({
      userId,
      folderId: input.folderId ?? null,
      projectId: resolvedProjectId,
      sessionId: input.sessionId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "open",
      priority: input.priority ?? "medium",
      source: input.source ?? "manual",
      labels: JSON.stringify(input.labels ?? []),
      subtasks: JSON.stringify(input.subtasks ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      instructions: input.instructions ?? null,
      agentTaskKey: input.agentTaskKey ?? null,
      owner: input.owner ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      githubIssueUrl: input.githubIssueUrl ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  const task = parseTaskRow(row);

  if (input.blockedBy && input.blockedBy.length > 0) {
    await setDependencies(task.id, input.blockedBy);
    task.blockedBy = input.blockedBy;
  }

  return task;
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
  if (input.metadata !== undefined)
    updates.metadata = JSON.stringify(input.metadata);
  if (input.instructions !== undefined)
    updates.instructions = input.instructions;
  if (input.agentTaskKey !== undefined)
    updates.agentTaskKey = input.agentTaskKey;
  if (input.owner !== undefined) updates.owner = input.owner;
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

  if (!results[0]) return null;
  const task = parseTaskRow(results[0]);

  if (input.blockedBy !== undefined) {
    await setDependencies(taskId, input.blockedBy);
    task.blockedBy = input.blockedBy;
  }
  // Skip loading deps when blockedBy wasn't touched — callers
  // that need it (e.g., API responses) can use getTask() instead.

  return task;
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

/** Get ALL tasks for a session regardless of source (agent + manual) */
export async function getAllTasksBySession(
  sessionId: string,
  userId: string
): Promise<ProjectTask[]> {
  const rows = await db
    .select()
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.sessionId, sessionId),
        eq(projectTasks.userId, userId)
      )
    )
    .orderBy(asc(projectTasks.sortOrder), asc(projectTasks.createdAt));
  return rows.map(parseTaskRow);
}

/** Get agent-sourced tasks for a specific session */
export async function getTasksBySession(
  sessionId: string,
  userId: string
): Promise<ProjectTask[]> {
  const all = await getAllTasksBySession(sessionId, userId);
  return all.filter((t) => t.source === "agent");
}

/** Bulk delete tasks by source, with optional session and completed-only filters. */
export async function clearTasks(
  userId: string,
  folderId: string,
  source?: TaskSource,
  options?: { sessionId?: string; completedOnly?: boolean }
): Promise<number> {
  const conditions = [
    eq(projectTasks.userId, userId),
    eq(projectTasks.folderId, folderId),
  ];

  if (source) {
    conditions.push(eq(projectTasks.source, source));
  }

  if (options?.sessionId) {
    conditions.push(eq(projectTasks.sessionId, options.sessionId));
  }

  if (options?.completedOnly) {
    conditions.push(
      inArray(projectTasks.status, ["done", "cancelled"])
    );
  }

  const result = await db
    .delete(projectTasks)
    .where(and(...conditions))
    .returning({ id: projectTasks.id });

  return result.length;
}

/**
 * Bulk-cancel open/in-progress agent tasks for a session.
 * Used when a session is closed — single UPDATE instead of N round-trips.
 */
export async function cancelOpenAgentTasks(
  sessionId: string,
  userId: string
): Promise<number> {
  const result = await db
    .update(projectTasks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(projectTasks.sessionId, sessionId),
        eq(projectTasks.userId, userId),
        eq(projectTasks.source, "agent"),
        inArray(projectTasks.status, ["open", "in_progress"])
      )
    )
    .returning({ id: projectTasks.id });
  return result.length;
}

// --- Dependency management ---

/**
 * Replace all blockers for a task with the given IDs.
 * Rejects self-references silently.
 */
export async function setDependencies(
  taskId: string,
  blockerIds: string[]
): Promise<void> {
  // Filter out self-references and duplicates
  const unique = [...new Set(blockerIds.filter((id) => id !== taskId))];

  await db.transaction(async (tx) => {
    // Remove existing blockers for this task
    await tx
      .delete(taskDependencies)
      .where(eq(taskDependencies.blockedId, taskId));

    if (unique.length === 0) return;

    await tx.insert(taskDependencies).values(
      unique.map((blockerId) => ({
        blockerId,
        blockedId: taskId,
      }))
    );
  });
}

