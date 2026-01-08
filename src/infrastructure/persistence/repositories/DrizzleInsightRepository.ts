/**
 * DrizzleInsightRepository - Drizzle ORM implementation of IInsightRepository.
 *
 * This repository handles persistence of OrchestratorInsight entities using Drizzle ORM.
 * It converts between domain entities and database records using mappers.
 */

import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "@/db";
import { orchestratorInsights } from "@/db/schema";
import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import type { IInsightRepository } from "@/application/ports/IInsightRepository";
import type { InsightType, InsightSeverity, SuggestedAction } from "@/types/orchestrator";

export class DrizzleInsightRepository implements IInsightRepository {
  async findById(insightId: string): Promise<OrchestratorInsight | null> {
    const result = await db
      .select()
      .from(orchestratorInsights)
      .where(eq(orchestratorInsights.id, insightId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.toDomain(result[0]);
  }

  async findByOrchestratorId(orchestratorId: string): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(eq(orchestratorInsights.orchestratorId, orchestratorId))
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findBySessionId(sessionId: string): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(eq(orchestratorInsights.sessionId, sessionId))
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findUnresolvedByOrchestratorId(
    orchestratorId: string
  ): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          eq(orchestratorInsights.resolved, false)
        )
      )
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findUnresolvedBySessionId(sessionId: string): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.sessionId, sessionId),
          eq(orchestratorInsights.resolved, false)
        )
      )
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findByType(
    orchestratorId: string,
    type: InsightType
  ): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          eq(orchestratorInsights.type, type)
        )
      )
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findBySeverity(
    orchestratorId: string,
    severity: InsightSeverity
  ): Promise<OrchestratorInsight[]> {
    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          eq(orchestratorInsights.severity, severity)
        )
      )
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async findCriticalByOrchestratorId(
    orchestratorId: string
  ): Promise<OrchestratorInsight[]> {
    return this.findBySeverity(orchestratorId, "critical");
  }

  async findRecentByOrchestratorId(
    orchestratorId: string,
    maxAgeSeconds: number
  ): Promise<OrchestratorInsight[]> {
    const cutoffDate = new Date(Date.now() - maxAgeSeconds * 1000);

    const results = await db
      .select()
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          gte(orchestratorInsights.createdAt, cutoffDate)
        )
      )
      .orderBy(desc(orchestratorInsights.createdAt));

    return results.map((row) => this.toDomain(row));
  }

  async save(insight: OrchestratorInsight): Promise<void> {
    const record = this.toDatabase(insight);
    await db.insert(orchestratorInsights).values(record);
  }

  async update(insight: OrchestratorInsight): Promise<void> {
    const record = this.toDatabase(insight);
    await db
      .update(orchestratorInsights)
      .set({
        resolved: record.resolved,
        resolvedAt: record.resolvedAt,
      })
      .where(eq(orchestratorInsights.id, insight.id));
  }

  async delete(insightId: string): Promise<boolean> {
    const result = await db
      .delete(orchestratorInsights)
      .where(eq(orchestratorInsights.id, insightId))
      .returning({ id: orchestratorInsights.id });

    return result.length > 0;
  }

  async countUnresolvedByOrchestratorId(orchestratorId: string): Promise<number> {
    const result = await db
      .select({ count: orchestratorInsights.id })
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          eq(orchestratorInsights.resolved, false)
        )
      );

    return result.length;
  }

  async countBySeverity(
    orchestratorId: string,
    severity: InsightSeverity
  ): Promise<number> {
    const result = await db
      .select({ count: orchestratorInsights.id })
      .from(orchestratorInsights)
      .where(
        and(
          eq(orchestratorInsights.orchestratorId, orchestratorId),
          eq(orchestratorInsights.severity, severity)
        )
      );

    return result.length;
  }

  // ============================================================================
  // Mappers
  // ============================================================================

  private toDomain(row: typeof orchestratorInsights.$inferSelect): OrchestratorInsight {
    // Parse JSON fields
    const context = row.contextJson ? JSON.parse(row.contextJson) : null;
    const suggestedActions: SuggestedAction[] = row.suggestedActions
      ? JSON.parse(row.suggestedActions)
      : [];

    return OrchestratorInsight.reconstitute({
      id: row.id,
      orchestratorId: row.orchestratorId,
      sessionId: row.sessionId,
      type: row.type as InsightType,
      severity: row.severity as InsightSeverity,
      message: row.message,
      context,
      suggestedActions,
      resolved: row.resolved,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    });
  }

  private toDatabase(
    insight: OrchestratorInsight
  ): typeof orchestratorInsights.$inferInsert {
    // Serialize JSON fields
    const contextJson = insight.context ? JSON.stringify(insight.context) : null;
    const suggestedActionsJson =
      insight.suggestedActions.length > 0
        ? JSON.stringify(insight.suggestedActions)
        : null;

    return {
      id: insight.id,
      orchestratorId: insight.orchestratorId,
      sessionId: insight.sessionId,
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      contextJson,
      suggestedActions: suggestedActionsJson,
      resolved: insight.resolved,
      resolvedAt: insight.resolvedAt,
      createdAt: insight.createdAt,
    };
  }
}
