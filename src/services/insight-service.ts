/**
 * InsightService - Manages orchestrator insights
 *
 * This service provides operations for querying and managing insights generated
 * by orchestrators during session monitoring. Insights include stall detection,
 * error patterns, and suggested actions.
 */
import { db } from "@/db";
import { orchestratorInsights } from "@/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import type { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import type { InsightType, InsightSeverity } from "@/types/orchestrator";

/**
 * Error class for insight service operations
 */
export class InsightServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly insightId?: string
  ) {
    super(message);
    this.name = "InsightServiceError";
  }
}

/**
 * Insight filter options
 */
export interface InsightFilters {
  orchestratorId?: string;
  sessionId?: string;
  type?: InsightType;
  severity?: InsightSeverity;
  resolved?: boolean;
  maxAgeSeconds?: number;
}

/**
 * Get insight by ID
 */
export async function getInsight(insightId: string): Promise<OrchestratorInsight | null> {
  const result = await db
    .select()
    .from(orchestratorInsights)
    .where(eq(orchestratorInsights.id, insightId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Reconstitute domain entity
  const { OrchestratorInsight } = await import("@/domain/entities/OrchestratorInsight");
  const row = result[0];

  return OrchestratorInsight.reconstitute({
    id: row.id,
    orchestratorId: row.orchestratorId,
    sessionId: row.sessionId,
    type: row.type as InsightType,
    severity: row.severity as InsightSeverity,
    message: row.message,
    context: row.contextJson ? JSON.parse(row.contextJson) : null,
    suggestedActions: row.suggestedActions ? JSON.parse(row.suggestedActions) : [],
    resolved: row.resolved,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  });
}

/**
 * List insights with filters
 */
export async function listInsights(
  filters: InsightFilters,
  limit: number = 50
): Promise<OrchestratorInsight[]> {
  let query = db.select().from(orchestratorInsights);

  // Build where clause
  const conditions = [];

  if (filters.orchestratorId) {
    conditions.push(eq(orchestratorInsights.orchestratorId, filters.orchestratorId));
  }

  if (filters.sessionId) {
    conditions.push(eq(orchestratorInsights.sessionId, filters.sessionId));
  }

  if (filters.type) {
    conditions.push(eq(orchestratorInsights.type, filters.type));
  }

  if (filters.severity) {
    conditions.push(eq(orchestratorInsights.severity, filters.severity));
  }

  if (filters.resolved !== undefined) {
    conditions.push(eq(orchestratorInsights.resolved, filters.resolved));
  }

  if (filters.maxAgeSeconds) {
    const cutoffDate = new Date(Date.now() - filters.maxAgeSeconds * 1000);
    conditions.push(gte(orchestratorInsights.createdAt, cutoffDate));
  }

  // Apply conditions
  if (conditions.length > 0) {
    query = query.where(
      conditions.length === 1 ? conditions[0] : and(...conditions)
    ) as typeof query;
  }

  const results = await query.orderBy(desc(orchestratorInsights.createdAt)).limit(limit);

  // Reconstitute domain entities
  const { OrchestratorInsight } = await import("@/domain/entities/OrchestratorInsight");
  return results.map((row) =>
    OrchestratorInsight.reconstitute({
      id: row.id,
      orchestratorId: row.orchestratorId,
      sessionId: row.sessionId,
      type: row.type as InsightType,
      severity: row.severity as InsightSeverity,
      message: row.message,
      context: row.contextJson ? JSON.parse(row.contextJson) : null,
      suggestedActions: row.suggestedActions ? JSON.parse(row.suggestedActions) : [],
      resolved: row.resolved,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    })
  );
}

/**
 * Get unresolved insights for a session
 */
export async function getUnresolvedInsightsForSession(
  sessionId: string
): Promise<OrchestratorInsight[]> {
  return listInsights({
    sessionId,
    resolved: false,
  });
}

/**
 * Get critical insights for an orchestrator
 */
export async function getCriticalInsights(
  orchestratorId: string
): Promise<OrchestratorInsight[]> {
  return listInsights({
    orchestratorId,
    severity: "critical",
    resolved: false,
  });
}

/**
 * Get recent insights for an orchestrator
 */
export async function getRecentInsights(
  orchestratorId: string,
  maxAgeSeconds: number = 3600 // Default: 1 hour
): Promise<OrchestratorInsight[]> {
  return listInsights({
    orchestratorId,
    maxAgeSeconds,
  });
}

/**
 * Mark an insight as resolved
 */
export async function resolveInsight(insightId: string): Promise<OrchestratorInsight> {
  // Get existing insight
  const insight = await getInsight(insightId);
  if (!insight) {
    throw new InsightServiceError("Insight not found", "INSIGHT_NOT_FOUND", insightId);
  }

  if (insight.resolved) {
    // Already resolved, return as-is
    return insight;
  }

  // Mark as resolved
  const resolved = insight.resolve();

  // Update in database
  await db
    .update(orchestratorInsights)
    .set({
      resolved: true,
      resolvedAt: new Date(),
    })
    .where(eq(orchestratorInsights.id, insightId));

  return resolved;
}

/**
 * Delete an insight
 */
export async function deleteInsight(insightId: string): Promise<boolean> {
  const result = await db
    .delete(orchestratorInsights)
    .where(eq(orchestratorInsights.id, insightId))
    .returning({ id: orchestratorInsights.id });

  return result.length > 0;
}

/**
 * Get insight counts for an orchestrator
 */
export async function getInsightCounts(orchestratorId: string): Promise<{
  total: number;
  unresolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}> {
  const insights = await db
    .select()
    .from(orchestratorInsights)
    .where(eq(orchestratorInsights.orchestratorId, orchestratorId));

  const unresolved = insights.filter((i) => !i.resolved);

  return {
    total: insights.length,
    unresolved: unresolved.length,
    critical: unresolved.filter((i) => i.severity === "critical").length,
    high: unresolved.filter((i) => i.severity === "high").length,
    medium: unresolved.filter((i) => i.severity === "medium").length,
    low: unresolved.filter((i) => i.severity === "low").length,
  };
}

/**
 * Get insights grouped by type for an orchestrator
 */
export async function getInsightsByType(
  orchestratorId: string
): Promise<Map<InsightType, OrchestratorInsight[]>> {
  const insights = await listInsights({ orchestratorId });

  const grouped = new Map<InsightType, OrchestratorInsight[]>();

  for (const insight of insights) {
    const existing = grouped.get(insight.type) || [];
    existing.push(insight);
    grouped.set(insight.type, existing);
  }

  return grouped;
}

/**
 * Bulk resolve insights for a session
 */
export async function resolveSessionInsights(sessionId: string): Promise<number> {
  const result = await db
    .update(orchestratorInsights)
    .set({
      resolved: true,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(orchestratorInsights.sessionId, sessionId),
        eq(orchestratorInsights.resolved, false)
      )
    )
    .returning({ id: orchestratorInsights.id });

  return result.length;
}

/**
 * Clean up old resolved insights
 */
export async function cleanupOldInsights(
  maxAgeSeconds: number = 30 * 24 * 60 * 60 // Default: 30 days
): Promise<number> {
  const cutoffDate = new Date(Date.now() - maxAgeSeconds * 1000);

  const result = await db
    .delete(orchestratorInsights)
    .where(
      and(
        eq(orchestratorInsights.resolved, true),
        lte(orchestratorInsights.resolvedAt as any, cutoffDate)
      )
    )
    .returning({ id: orchestratorInsights.id });

  return result.length;
}
