/**
 * DrizzleTaskRepository - Drizzle ORM implementation of ITaskRepository
 *
 * Handles all task persistence operations using Drizzle ORM.
 * Converts between database records and Task domain entities using TaskMapper.
 */

import { db } from "@/db";
import { tasks, type TaskStatusType } from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import type { Task } from "@/domain/entities/Task";
import type { ITaskRepository } from "@/application/ports/task-ports";
import { TaskMapper, type TaskDbRecord } from "../mappers/TaskMapper";

export class DrizzleTaskRepository implements ITaskRepository {
  /**
   * Save a new or updated task.
   */
  async save(task: Task): Promise<void> {
    const data = TaskMapper.toPersistence(task);

    await db
      .insert(tasks)
      .values(data)
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Find a task by ID.
   */
  async findById(id: string): Promise<Task | null> {
    const record = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });

    return record ? TaskMapper.toDomain(record as TaskDbRecord) : null;
  }

  /**
   * Find all tasks for an orchestrator.
   */
  async findByOrchestratorId(orchestratorId: string): Promise<Task[]> {
    const records = await db.query.tasks.findMany({
      where: eq(tasks.orchestratorId, orchestratorId),
      orderBy: desc(tasks.createdAt),
    });

    return TaskMapper.toDomainMany(records as TaskDbRecord[]);
  }

  /**
   * Find all tasks for a user.
   */
  async findByUserId(userId: string): Promise<Task[]> {
    const records = await db.query.tasks.findMany({
      where: eq(tasks.userId, userId),
      orderBy: desc(tasks.createdAt),
    });

    return TaskMapper.toDomainMany(records as TaskDbRecord[]);
  }

  /**
   * Find tasks by status for an orchestrator.
   */
  async findByStatus(orchestratorId: string, statuses: string[]): Promise<Task[]> {
    const records = await db.query.tasks.findMany({
      where: and(
        eq(tasks.orchestratorId, orchestratorId),
        inArray(tasks.status, statuses as TaskStatusType[])
      ),
      orderBy: desc(tasks.createdAt),
    });

    return TaskMapper.toDomainMany(records as TaskDbRecord[]);
  }

  /**
   * Find a task linked to a beads issue.
   */
  async findByBeadsIssueId(beadsIssueId: string): Promise<Task | null> {
    const record = await db.query.tasks.findFirst({
      where: eq(tasks.beadsIssueId, beadsIssueId),
    });

    return record ? TaskMapper.toDomain(record as TaskDbRecord) : null;
  }

  /**
   * Delete a task.
   */
  async delete(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  /**
   * Find queued tasks for an orchestrator (for processing).
   */
  async findQueued(orchestratorId: string, limit?: number): Promise<Task[]> {
    const records = await db.query.tasks.findMany({
      where: and(eq(tasks.orchestratorId, orchestratorId), eq(tasks.status, "queued")),
      orderBy: tasks.createdAt,
      limit: limit ?? 10,
    });

    return TaskMapper.toDomainMany(records as TaskDbRecord[]);
  }

  /**
   * Find active (non-terminal) tasks for an orchestrator.
   */
  async findActive(orchestratorId: string): Promise<Task[]> {
    const activeStatuses: TaskStatusType[] = ["queued", "planning", "executing", "monitoring"];

    const records = await db.query.tasks.findMany({
      where: and(
        eq(tasks.orchestratorId, orchestratorId),
        inArray(tasks.status, activeStatuses)
      ),
      orderBy: desc(tasks.createdAt),
    });

    return TaskMapper.toDomainMany(records as TaskDbRecord[]);
  }

  /**
   * Count tasks by status for an orchestrator.
   */
  async countByStatus(orchestratorId: string): Promise<Record<string, number>> {
    const allTasks = await db.query.tasks.findMany({
      where: eq(tasks.orchestratorId, orchestratorId),
      columns: { status: true },
    });

    const counts: Record<string, number> = {
      queued: 0,
      planning: 0,
      executing: 0,
      monitoring: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of allTasks) {
      if (task.status in counts) {
        counts[task.status]++;
      }
    }

    return counts;
  }
}
