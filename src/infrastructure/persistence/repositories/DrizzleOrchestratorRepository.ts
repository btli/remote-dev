/**
 * DrizzleOrchestratorRepository - Drizzle ORM implementation of IOrchestratorRepository.
 *
 * This repository handles persistence of Orchestrator entities using Drizzle ORM.
 * It converts between domain entities and database records using mappers.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestratorSessions } from "@/db/schema";
import { Orchestrator } from "@/domain/entities/Orchestrator";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { OrchestratorType, OrchestratorStatus } from "@/types/orchestrator";
import type { TransactionContext } from "@/infrastructure/persistence/TransactionManager";

export class DrizzleOrchestratorRepository implements IOrchestratorRepository {
  async findById(orchestratorId: string, tx?: TransactionContext): Promise<Orchestrator | null> {
    const dbContext = tx ?? db;
    const result = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.id, orchestratorId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.toDomain(result[0]);
  }

  async findByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator[]> {
    const dbContext = tx ?? db;
    const results = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.userId, userId))
      .orderBy(desc(orchestratorSessions.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findByUserIdAndType(
    userId: string,
    type: OrchestratorType,
    tx?: TransactionContext
  ): Promise<Orchestrator[]> {
    const dbContext = tx ?? db;
    const results = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, userId),
          eq(orchestratorSessions.type, type)
        )
      )
      .orderBy(desc(orchestratorSessions.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findMasterByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator | null> {
    const dbContext = tx ?? db;
    const result = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, userId),
          eq(orchestratorSessions.type, "master")
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.toDomain(result[0]);
  }

  async findByScope(userId: string, scopeId: string, tx?: TransactionContext): Promise<Orchestrator[]> {
    const dbContext = tx ?? db;
    const results = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, userId),
          eq(orchestratorSessions.scopeId, scopeId)
        )
      )
      .orderBy(desc(orchestratorSessions.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findActiveByUserId(userId: string, tx?: TransactionContext): Promise<Orchestrator[]> {
    const dbContext = tx ?? db;
    const results = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.userId, userId))
      .orderBy(desc(orchestratorSessions.createdAt));

    // Filter out paused orchestrators
    return results
      .map((row) => this.toDomain(row))
      .filter((orchestrator) => orchestrator.status !== "paused");
  }

  async findByStatus(
    userId: string,
    status: OrchestratorStatus,
    tx?: TransactionContext
  ): Promise<Orchestrator[]> {
    const dbContext = tx ?? db;
    const results = await dbContext
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, userId),
          eq(orchestratorSessions.status, status)
        )
      )
      .orderBy(desc(orchestratorSessions.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async hasMaster(userId: string, tx?: TransactionContext): Promise<boolean> {
    const dbContext = tx ?? db;
    const result = await dbContext
      .select({ id: orchestratorSessions.id })
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.userId, userId),
          eq(orchestratorSessions.type, "master")
        )
      )
      .limit(1);

    return result.length > 0;
  }

  async save(orchestrator: Orchestrator, tx?: TransactionContext): Promise<void> {
    const dbContext = tx ?? db;
    const record = this.toDatabase(orchestrator);
    await dbContext.insert(orchestratorSessions).values(record);
  }

  async update(orchestrator: Orchestrator, tx?: TransactionContext): Promise<void> {
    const dbContext = tx ?? db;
    const record = this.toDatabase(orchestrator);
    await dbContext
      .update(orchestratorSessions)
      .set({
        status: record.status,
        customInstructions: record.customInstructions,
        monitoringInterval: record.monitoringInterval,
        stallThreshold: record.stallThreshold,
        autoIntervention: record.autoIntervention,
        lastActivityAt: record.lastActivityAt,
        updatedAt: record.updatedAt,
      })
      .where(eq(orchestratorSessions.id, orchestrator.id));
  }

  async delete(orchestratorId: string, tx?: TransactionContext): Promise<boolean> {
    const dbContext = tx ?? db;
    const result = await dbContext
      .delete(orchestratorSessions)
      .where(eq(orchestratorSessions.id, orchestratorId))
      .returning({ id: orchestratorSessions.id });

    return result.length > 0;
  }

  async countByUserId(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.userId, userId));

    return result[0]?.count ?? 0;
  }

  // ============================================================================
  // Mappers
  // ============================================================================

  private toDomain(row: typeof orchestratorSessions.$inferSelect): Orchestrator {
    return Orchestrator.reconstitute({
      id: row.id,
      sessionId: row.sessionId,
      userId: row.userId,
      type: row.type as "master" | "sub_orchestrator",
      status: row.status as "idle" | "analyzing" | "acting" | "paused",
      scopeType: row.scopeType as "folder" | null,
      scopeId: row.scopeId,
      customInstructions: row.customInstructions,
      monitoringInterval: row.monitoringInterval,
      stallThreshold: row.stallThreshold,
      autoIntervention: row.autoIntervention,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private toDatabase(
    orchestrator: Orchestrator
  ): typeof orchestratorSessions.$inferInsert {
    return {
      id: orchestrator.id,
      sessionId: orchestrator.sessionId,
      userId: orchestrator.userId,
      type: orchestrator.type,
      status: orchestrator.status,
      scopeType: orchestrator.scopeType,
      scopeId: orchestrator.scopeId,
      customInstructions: orchestrator.customInstructions,
      monitoringInterval: orchestrator.monitoringInterval,
      stallThreshold: orchestrator.stallThreshold,
      autoIntervention: orchestrator.autoIntervention,
      lastActivityAt: orchestrator.lastActivityAt,
      createdAt: orchestrator.createdAt,
      updatedAt: orchestrator.updatedAt,
    };
  }
}
