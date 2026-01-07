/**
 * ActivityDashboardService - Tracks and analyzes agent session activity
 *
 * Provides analytics for AI agent usage patterns including:
 * - Sessions per agent type
 * - Command frequency analysis
 * - Error rate tracking
 * - Daily/weekly/monthly trends
 */

import { db } from "@/db";
import { agentActivityEvents, agentDailyStats, terminalSessions } from "@/db/schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import type { AgentProviderType } from "@/types/session";

// ============================================================================
// Types
// ============================================================================

export type ActivityEventType =
  | "session_start"
  | "session_end"
  | "command"
  | "error"
  | "tool_call";

export interface ActivityEvent {
  id: string;
  userId: string;
  sessionId: string | null;
  agentProvider: AgentProviderType | null;
  eventType: ActivityEventType;
  eventData?: Record<string, unknown>;
  duration?: number;
  success?: boolean;
  errorMessage?: string;
  createdAt: Date;
}

export interface CreateActivityEventInput {
  sessionId?: string;
  agentProvider?: AgentProviderType;
  eventType: ActivityEventType;
  eventData?: Record<string, unknown>;
  duration?: number;
  success?: boolean;
  errorMessage?: string;
}

export interface DailyStats {
  date: string;
  agentProvider: AgentProviderType | null;
  sessionCount: number;
  commandCount: number;
  errorCount: number;
  totalDuration: number;
  toolCallCount: number;
}

export interface DashboardSummary {
  totalSessions: number;
  totalCommands: number;
  totalErrors: number;
  totalDuration: number;
  errorRate: number; // percentage
  sessionsByProvider: Record<string, number>;
  dailyStats: DailyStats[];
  recentEvents: ActivityEvent[];
}

export interface ProviderStats {
  provider: AgentProviderType;
  sessionCount: number;
  commandCount: number;
  errorCount: number;
  avgSessionDuration: number;
  errorRate: number;
}

// ============================================================================
// Event Tracking
// ============================================================================

/**
 * Record an activity event
 */
export async function trackEvent(
  userId: string,
  input: CreateActivityEventInput
): Promise<ActivityEvent> {
  const now = new Date();

  const [event] = await db
    .insert(agentActivityEvents)
    .values({
      userId,
      sessionId: input.sessionId ?? null,
      agentProvider: input.agentProvider ?? null,
      eventType: input.eventType,
      eventData: input.eventData ? JSON.stringify(input.eventData) : null,
      duration: input.duration ?? null,
      success: input.success ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt: now,
    })
    .returning();

  // Update daily stats
  await updateDailyStats(userId, input.agentProvider ?? null, input.eventType);

  return mapDbToEvent(event);
}

/**
 * Track a session start event
 */
export async function trackSessionStart(
  userId: string,
  sessionId: string,
  agentProvider?: AgentProviderType
): Promise<void> {
  await trackEvent(userId, {
    sessionId,
    agentProvider,
    eventType: "session_start",
    success: true,
  });
}

/**
 * Track a session end event
 */
export async function trackSessionEnd(
  userId: string,
  sessionId: string,
  duration: number,
  agentProvider?: AgentProviderType
): Promise<void> {
  await trackEvent(userId, {
    sessionId,
    agentProvider,
    eventType: "session_end",
    duration,
    success: true,
  });
}

/**
 * Track an error event
 */
export async function trackError(
  userId: string,
  errorMessage: string,
  sessionId?: string,
  agentProvider?: AgentProviderType
): Promise<void> {
  await trackEvent(userId, {
    sessionId,
    agentProvider,
    eventType: "error",
    success: false,
    errorMessage,
  });
}

/**
 * Track a tool call event
 */
export async function trackToolCall(
  userId: string,
  toolName: string,
  success: boolean,
  duration?: number,
  sessionId?: string,
  agentProvider?: AgentProviderType
): Promise<void> {
  await trackEvent(userId, {
    sessionId,
    agentProvider,
    eventType: "tool_call",
    eventData: { toolName },
    duration,
    success,
  });
}

// ============================================================================
// Analytics Queries
// ============================================================================

/**
 * Get dashboard summary for a user
 */
export async function getDashboardSummary(
  userId: string,
  days = 30
): Promise<DashboardSummary> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get totals from daily stats
  const stats = await db.query.agentDailyStats.findMany({
    where: and(
      eq(agentDailyStats.userId, userId),
      gte(agentDailyStats.date, startDate.toISOString().split("T")[0])
    ),
  });

  const totalSessions = stats.reduce((sum, s) => sum + s.sessionCount, 0);
  const totalCommands = stats.reduce((sum, s) => sum + s.commandCount, 0);
  const totalErrors = stats.reduce((sum, s) => sum + s.errorCount, 0);
  const totalDuration = stats.reduce((sum, s) => sum + s.totalDuration, 0);
  const errorRate =
    totalSessions > 0 ? (totalErrors / totalSessions) * 100 : 0;

  // Sessions by provider
  const sessionsByProvider: Record<string, number> = {};
  for (const stat of stats) {
    const provider = stat.agentProvider ?? "unknown";
    sessionsByProvider[provider] =
      (sessionsByProvider[provider] ?? 0) + stat.sessionCount;
  }

  // Get daily stats for chart
  const dailyStats = stats.map((s) => ({
    date: s.date,
    agentProvider: s.agentProvider as AgentProviderType | null,
    sessionCount: s.sessionCount,
    commandCount: s.commandCount,
    errorCount: s.errorCount,
    totalDuration: s.totalDuration,
    toolCallCount: s.toolCallCount,
  }));

  // Get recent events
  const recentEvents = await getRecentEvents(userId, 20);

  return {
    totalSessions,
    totalCommands,
    totalErrors,
    totalDuration,
    errorRate,
    sessionsByProvider,
    dailyStats,
    recentEvents,
  };
}

/**
 * Get stats per provider
 */
export async function getProviderStats(
  userId: string,
  days = 30
): Promise<ProviderStats[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const stats = await db.query.agentDailyStats.findMany({
    where: and(
      eq(agentDailyStats.userId, userId),
      gte(agentDailyStats.date, startDate.toISOString().split("T")[0])
    ),
  });

  // Aggregate by provider
  const byProvider = new Map<
    string,
    {
      sessionCount: number;
      commandCount: number;
      errorCount: number;
      totalDuration: number;
    }
  >();

  for (const stat of stats) {
    const provider = stat.agentProvider ?? "unknown";
    const existing = byProvider.get(provider) ?? {
      sessionCount: 0,
      commandCount: 0,
      errorCount: 0,
      totalDuration: 0,
    };

    byProvider.set(provider, {
      sessionCount: existing.sessionCount + stat.sessionCount,
      commandCount: existing.commandCount + stat.commandCount,
      errorCount: existing.errorCount + stat.errorCount,
      totalDuration: existing.totalDuration + stat.totalDuration,
    });
  }

  const result: ProviderStats[] = [];
  for (const [provider, data] of byProvider) {
    if (provider === "unknown") continue;

    const avgSessionDuration =
      data.sessionCount > 0 ? data.totalDuration / data.sessionCount : 0;
    const errorRate =
      data.sessionCount > 0 ? (data.errorCount / data.sessionCount) * 100 : 0;

    result.push({
      provider: provider as AgentProviderType,
      sessionCount: data.sessionCount,
      commandCount: data.commandCount,
      errorCount: data.errorCount,
      avgSessionDuration,
      errorRate,
    });
  }

  return result.sort((a, b) => b.sessionCount - a.sessionCount);
}

/**
 * Get recent activity events
 */
export async function getRecentEvents(
  userId: string,
  limit = 50
): Promise<ActivityEvent[]> {
  const events = await db.query.agentActivityEvents.findMany({
    where: eq(agentActivityEvents.userId, userId),
    orderBy: [desc(agentActivityEvents.createdAt)],
    limit,
  });

  return events.map(mapDbToEvent);
}

/**
 * Get events by type
 */
export async function getEventsByType(
  userId: string,
  eventType: ActivityEventType,
  limit = 100
): Promise<ActivityEvent[]> {
  const events = await db.query.agentActivityEvents.findMany({
    where: and(
      eq(agentActivityEvents.userId, userId),
      eq(agentActivityEvents.eventType, eventType)
    ),
    orderBy: [desc(agentActivityEvents.createdAt)],
    limit,
  });

  return events.map(mapDbToEvent);
}

/**
 * Get error events for debugging
 */
export async function getErrors(
  userId: string,
  limit = 50
): Promise<ActivityEvent[]> {
  return getEventsByType(userId, "error", limit);
}

/**
 * Get session count by provider for a time period
 */
export async function getSessionCountByProvider(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<Record<string, number>> {
  const stats = await db.query.agentDailyStats.findMany({
    where: and(
      eq(agentDailyStats.userId, userId),
      gte(agentDailyStats.date, startDate.toISOString().split("T")[0]),
      lte(agentDailyStats.date, endDate.toISOString().split("T")[0])
    ),
  });

  const byProvider: Record<string, number> = {};
  for (const stat of stats) {
    const provider = stat.agentProvider ?? "unknown";
    byProvider[provider] = (byProvider[provider] ?? 0) + stat.sessionCount;
  }

  return byProvider;
}

/**
 * Get active sessions count (from the sessions table)
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(terminalSessions)
    .where(
      and(
        eq(terminalSessions.userId, userId),
        eq(terminalSessions.status, "active")
      )
    );

  return result[0]?.count ?? 0;
}

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Update daily aggregated stats
 */
async function updateDailyStats(
  userId: string,
  agentProvider: AgentProviderType | null,
  eventType: ActivityEventType
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  // Try to find existing record
  const existing = await db.query.agentDailyStats.findFirst({
    where: and(
      eq(agentDailyStats.userId, userId),
      eq(agentDailyStats.date, today),
      agentProvider
        ? eq(agentDailyStats.agentProvider, agentProvider)
        : sql`${agentDailyStats.agentProvider} IS NULL`
    ),
  });

  const updates: Partial<{
    sessionCount: number;
    commandCount: number;
    errorCount: number;
    toolCallCount: number;
  }> = {};

  // Determine which counter to increment
  switch (eventType) {
    case "session_start":
      updates.sessionCount = (existing?.sessionCount ?? 0) + 1;
      break;
    case "command":
      updates.commandCount = (existing?.commandCount ?? 0) + 1;
      break;
    case "error":
      updates.errorCount = (existing?.errorCount ?? 0) + 1;
      break;
    case "tool_call":
      updates.toolCallCount = (existing?.toolCallCount ?? 0) + 1;
      break;
  }

  if (existing) {
    await db
      .update(agentDailyStats)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(agentDailyStats.id, existing.id));
  } else {
    await db.insert(agentDailyStats).values({
      userId,
      date: today,
      agentProvider,
      sessionCount: updates.sessionCount ?? 0,
      commandCount: updates.commandCount ?? 0,
      errorCount: updates.errorCount ?? 0,
      toolCallCount: updates.toolCallCount ?? 0,
      totalDuration: 0,
      updatedAt: new Date(),
    });
  }
}

/**
 * Map database record to ActivityEvent
 */
function mapDbToEvent(
  record: typeof agentActivityEvents.$inferSelect
): ActivityEvent {
  return {
    id: record.id,
    userId: record.userId,
    sessionId: record.sessionId,
    agentProvider: record.agentProvider as AgentProviderType | null,
    eventType: record.eventType as ActivityEventType,
    eventData: record.eventData ? JSON.parse(record.eventData) : undefined,
    duration: record.duration ?? undefined,
    success: record.success ?? undefined,
    errorMessage: record.errorMessage ?? undefined,
    createdAt: new Date(record.createdAt),
  };
}

// Re-export error class from centralized location for backwards compatibility
export { ActivityDashboardError } from "@/lib/errors";
