/**
 * DrizzleDelegationRepository - Drizzle ORM implementation of IDelegationRepository
 *
 * Handles all delegation persistence operations using Drizzle ORM.
 * Converts between database records and Delegation domain entities using DelegationMapper.
 */

import { db } from "@/db";
import { delegations, type DelegationStatusType } from "@/db/schema";
import { eq, and, inArray, desc, not } from "drizzle-orm";
import type { Delegation } from "@/domain/entities/Delegation";
import type { IDelegationRepository } from "@/application/ports/task-ports";
import { DelegationMapper, type DelegationDbRecord } from "../mappers/DelegationMapper";

const TERMINAL_STATUSES: DelegationStatusType[] = ["completed", "failed"];

export class DrizzleDelegationRepository implements IDelegationRepository {
  /**
   * Save a new or updated delegation.
   */
  async save(delegation: Delegation): Promise<void> {
    const data = DelegationMapper.toPersistence(delegation);

    await db
      .insert(delegations)
      .values(data)
      .onConflictDoUpdate({
        target: delegations.id,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Find a delegation by ID.
   */
  async findById(id: string): Promise<Delegation | null> {
    const record = await db.query.delegations.findFirst({
      where: eq(delegations.id, id),
    });

    return record ? DelegationMapper.toDomain(record as DelegationDbRecord) : null;
  }

  /**
   * Find delegations by task ID.
   * Usually one-to-one but could have history (retries).
   */
  async findByTaskId(taskId: string): Promise<Delegation[]> {
    const records = await db.query.delegations.findMany({
      where: eq(delegations.taskId, taskId),
      orderBy: desc(delegations.createdAt),
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }

  /**
   * Find delegations by session ID.
   */
  async findBySessionId(sessionId: string): Promise<Delegation[]> {
    const records = await db.query.delegations.findMany({
      where: eq(delegations.sessionId, sessionId),
      orderBy: desc(delegations.createdAt),
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }

  /**
   * Find active (non-terminal) delegations.
   */
  async findActive(): Promise<Delegation[]> {
    const records = await db.query.delegations.findMany({
      where: not(inArray(delegations.status, TERMINAL_STATUSES)),
      orderBy: desc(delegations.createdAt),
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }

  /**
   * Find delegations by status.
   */
  async findByStatus(statuses: string[]): Promise<Delegation[]> {
    const records = await db.query.delegations.findMany({
      where: inArray(delegations.status, statuses as DelegationStatusType[]),
      orderBy: desc(delegations.createdAt),
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }

  /**
   * Delete a delegation.
   */
  async delete(id: string): Promise<void> {
    await db.delete(delegations).where(eq(delegations.id, id));
  }

  /**
   * Find the active delegation for a task (if any).
   * There should be at most one active delegation per task.
   */
  async findActiveForTask(taskId: string): Promise<Delegation | null> {
    const record = await db.query.delegations.findFirst({
      where: and(
        eq(delegations.taskId, taskId),
        not(inArray(delegations.status, TERMINAL_STATUSES))
      ),
      orderBy: desc(delegations.createdAt),
    });

    return record ? DelegationMapper.toDomain(record as DelegationDbRecord) : null;
  }

  /**
   * Find delegations that are running or monitoring (for monitoring service).
   */
  async findRunning(): Promise<Delegation[]> {
    const runningStatuses: DelegationStatusType[] = ["running", "monitoring"];
    const records = await db.query.delegations.findMany({
      where: inArray(delegations.status, runningStatuses),
      orderBy: delegations.createdAt,
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }

  /**
   * Count delegations by status.
   */
  async countByStatus(): Promise<Record<string, number>> {
    const allDelegations = await db.query.delegations.findMany({
      columns: { status: true },
    });

    const counts: Record<string, number> = {
      spawning: 0,
      injecting_context: 0,
      running: 0,
      monitoring: 0,
      completed: 0,
      failed: 0,
    };

    for (const delegation of allDelegations) {
      if (delegation.status in counts) {
        counts[delegation.status]++;
      }
    }

    return counts;
  }

  /**
   * Get completed delegations for a task (for retry analysis).
   */
  async getCompletedForTask(taskId: string): Promise<Delegation[]> {
    const records = await db.query.delegations.findMany({
      where: and(
        eq(delegations.taskId, taskId),
        inArray(delegations.status, TERMINAL_STATUSES)
      ),
      orderBy: desc(delegations.completedAt),
    });

    return DelegationMapper.toDomainMany(records as DelegationDbRecord[]);
  }
}
