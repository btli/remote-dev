/**
 * DrizzleAuditLogRepository - Drizzle ORM implementation of IAuditLogRepository.
 *
 * This repository handles persistence of OrchestratorAuditLog entities using Drizzle ORM.
 * It converts between domain entities and database records using mappers.
 *
 * Note: Audit logs are immutable - only save and query operations are supported.
 */

import { eq, and, desc, lte, gte, lt, count } from "drizzle-orm";
import { db } from "@/db";
import { orchestratorAuditLog } from "@/db/schema";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import type { AuditLogActionType } from "@/types/orchestrator";
import type { TransactionContext } from "@/infrastructure/persistence/TransactionManager";

export class DrizzleAuditLogRepository implements IAuditLogRepository {
  async findById(auditLogId: string): Promise<OrchestratorAuditLog | null> {
    const result = await db
      .select()
      .from(orchestratorAuditLog)
      .where(eq(orchestratorAuditLog.id, auditLogId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.toDomain(result[0]);
  }

  async findByOrchestratorId(orchestratorId: string): Promise<OrchestratorAuditLog[]> {
    const results = await db
      .select()
      .from(orchestratorAuditLog)
      .where(eq(orchestratorAuditLog.orchestratorId, orchestratorId))
      .orderBy(desc(orchestratorAuditLog.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findBySessionId(sessionId: string): Promise<OrchestratorAuditLog[]> {
    const results = await db
      .select()
      .from(orchestratorAuditLog)
      .where(eq(orchestratorAuditLog.targetSessionId, sessionId))
      .orderBy(desc(orchestratorAuditLog.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findByActionType(
    orchestratorId: string,
    actionType: AuditLogActionType
  ): Promise<OrchestratorAuditLog[]> {
    const results = await db
      .select()
      .from(orchestratorAuditLog)
      .where(
        and(
          eq(orchestratorAuditLog.orchestratorId, orchestratorId),
          eq(orchestratorAuditLog.actionType, actionType)
        )
      )
      .orderBy(desc(orchestratorAuditLog.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findRecentByOrchestratorId(
    orchestratorId: string,
    maxAgeSeconds: number
  ): Promise<OrchestratorAuditLog[]> {
    const cutoffDate = new Date(Date.now() - maxAgeSeconds * 1000);

    const results = await db
      .select()
      .from(orchestratorAuditLog)
      .where(
        and(
          eq(orchestratorAuditLog.orchestratorId, orchestratorId),
          gte(orchestratorAuditLog.createdAt, cutoffDate)
        )
      )
      .orderBy(desc(orchestratorAuditLog.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findByTimeRange(
    orchestratorId: string,
    startDate: Date,
    endDate: Date
  ): Promise<OrchestratorAuditLog[]> {
    const results = await db
      .select()
      .from(orchestratorAuditLog)
      .where(
        and(
          eq(orchestratorAuditLog.orchestratorId, orchestratorId),
          gte(orchestratorAuditLog.createdAt, startDate),
          lte(orchestratorAuditLog.createdAt, endDate)
        )
      )
      .orderBy(desc(orchestratorAuditLog.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findLatestByOrchestratorId(
    orchestratorId: string
  ): Promise<OrchestratorAuditLog | null> {
    const result = await db
      .select()
      .from(orchestratorAuditLog)
      .where(eq(orchestratorAuditLog.orchestratorId, orchestratorId))
      .orderBy(desc(orchestratorAuditLog.createdAt))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.toDomain(result[0]);
  }

  async save(auditLog: OrchestratorAuditLog, tx?: TransactionContext): Promise<void> {
    const dbContext = tx ?? db;
    const record = this.toDatabase(auditLog);
    await dbContext.insert(orchestratorAuditLog).values(record);
  }

  async countByOrchestratorId(orchestratorId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(orchestratorAuditLog)
      .where(eq(orchestratorAuditLog.orchestratorId, orchestratorId));

    return result[0]?.count ?? 0;
  }

  async countByActionType(
    orchestratorId: string,
    actionType: AuditLogActionType
  ): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(orchestratorAuditLog)
      .where(
        and(
          eq(orchestratorAuditLog.orchestratorId, orchestratorId),
          eq(orchestratorAuditLog.actionType, actionType)
        )
      );

    return result[0]?.count ?? 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await db
      .delete(orchestratorAuditLog)
      .where(lt(orchestratorAuditLog.createdAt, date))
      .returning({ id: orchestratorAuditLog.id });

    return result.length;
  }

  // ============================================================================
  // Mappers
  // ============================================================================

  private toDomain(
    row: typeof orchestratorAuditLog.$inferSelect
  ): OrchestratorAuditLog {
    // Parse JSON details field with error handling
    let details = null;
    if (row.detailsJson) {
      try {
        details = JSON.parse(row.detailsJson);
      } catch (error) {
        console.error(
          `Failed to parse detailsJson for audit log ${row.id}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with null details rather than failing
      }
    }

    return OrchestratorAuditLog.reconstitute({
      id: row.id,
      orchestratorId: row.orchestratorId,
      actionType: row.actionType as AuditLogActionType,
      targetSessionId: row.targetSessionId,
      details,
      createdAt: row.createdAt,
    });
  }

  private toDatabase(
    auditLog: OrchestratorAuditLog
  ): typeof orchestratorAuditLog.$inferInsert {
    // Serialize JSON details field
    const detailsJson = auditLog.details ? JSON.stringify(auditLog.details) : null;

    return {
      id: auditLog.id,
      orchestratorId: auditLog.orchestratorId,
      actionType: auditLog.actionType,
      targetSessionId: auditLog.targetSessionId,
      detailsJson,
      createdAt: auditLog.createdAt,
    };
  }
}
