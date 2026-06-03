/**
 * LiteLLM Analytics Service
 *
 * Thin facade over the dual-backend `AnalyticsStore` (SQLite or Postgres),
 * selected at runtime via `getAnalyticsStore()`. The concrete SQLite logic now
 * lives in `SqliteAnalyticsStore`; the Postgres logic in `PgAnalyticsStore`.
 *
 * Public API is unchanged except that the read functions are now `async`
 * (the port's read methods return Promises so the Postgres backend can do real
 * I/O). `recordRequest` / `recordBatch` remain synchronous fire-and-forget.
 */

import { getAnalyticsStore } from "@/infrastructure/persistence/sidecar-factory";
import type {
  AnalyticsSummary,
  SummaryOptions,
  TimeSeriesOptions,
  ModelBreakdownOptions,
  SessionAttributionOptions,
  LatencyPercentilesOptions,
} from "@/application/ports/AnalyticsStore";
import type {
  LiteLLMWebhookPayload,
  TimeSeriesPoint,
  ModelBreakdown,
  SessionAttribution,
  LatencyPercentiles,
} from "@/types/litellm";

// ---------------------------------------------------------------------------
// Write path (synchronous fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Record a single LiteLLM webhook event.
 * Delegates to recordBatch for consistent handling.
 */
export function recordRequest(payload: LiteLLMWebhookPayload): void {
  recordBatch([payload]);
}

/**
 * Record a batch of webhook events (LiteLLM may send arrays).
 */
export function recordBatch(payloads: LiteLLMWebhookPayload[]): void {
  getAnalyticsStore().recordBatch(payloads);
}

// ---------------------------------------------------------------------------
// Read path (async)
// ---------------------------------------------------------------------------

/** Get summary analytics for a date range. */
export function getSummary(opts: SummaryOptions): Promise<AnalyticsSummary> {
  return getAnalyticsStore().getSummary(opts);
}

/**
 * Get time-series data for charts.
 * Daily/weekly granularity reads from the daily aggregate; hourly reads from
 * the raw request log.
 */
export function getTimeSeries(
  opts: TimeSeriesOptions
): Promise<TimeSeriesPoint[]> {
  return getAnalyticsStore().getTimeSeries(opts);
}

/** Get per-model breakdown. */
export function getModelBreakdown(
  opts: ModelBreakdownOptions
): Promise<ModelBreakdown[]> {
  return getAnalyticsStore().getModelBreakdown(opts);
}

/** Get per-session cost attribution. */
export function getSessionAttribution(
  opts: SessionAttributionOptions
): Promise<SessionAttribution[]> {
  return getAnalyticsStore().getSessionAttribution(opts);
}

/** Get latency percentiles per model. */
export function getLatencyPercentiles(
  opts: LatencyPercentilesOptions
): Promise<LatencyPercentiles[]> {
  return getAnalyticsStore().getLatencyPercentiles(opts);
}

/**
 * Prune old request logs (default 90 days).
 * Daily aggregates are kept indefinitely (small footprint).
 */
export function pruneOldLogs(
  retentionDays = 90
): Promise<{ deletedCount: number }> {
  return getAnalyticsStore().pruneOldLogs(retentionDays);
}
