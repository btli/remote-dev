/**
 * AnalyticsStore - Port interface for persisting and querying LiteLLM usage
 * analytics.
 *
 * The analytics data lives in a sidecar store, separate from the main
 * application database. Two backends implement this port:
 *   - SQLite (default): synchronous better-sqlite3 writes, behavior-identical
 *     to the original litellm-analytics-service.
 *   - PostgreSQL: writes are async-buffered (never block the request path and
 *     drop under back-pressure rather than blocking); reads are async pg
 *     queries against the `analytics` schema.
 *
 * Write enqueue (`recordBatch`) is synchronous fire-and-forget on both
 * backends. Read methods are async (the SQLite implementation wraps its
 * synchronous results in `Promise.resolve`).
 */

import type {
  LiteLLMWebhookPayload,
  TimeSeriesPoint,
  ModelBreakdown,
  SessionAttribution,
  LatencyPercentiles,
} from "@/types/litellm";

/** Aggregate summary over a date range. */
export interface AnalyticsSummary {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  periodStart: string;
  periodEnd: string;
}

export interface SummaryOptions {
  startDate: Date;
  endDate: Date;
  model?: string;
}

export interface TimeSeriesOptions {
  startDate: Date;
  endDate: Date;
  granularity: "hourly" | "daily" | "weekly";
  model?: string;
  splitByModel?: boolean;
}

export interface ModelBreakdownOptions {
  startDate: Date;
  endDate: Date;
}

export interface SessionAttributionOptions {
  startDate: Date;
  endDate: Date;
  limit?: number;
}

export interface LatencyPercentilesOptions {
  startDate: Date;
  endDate: Date;
  model?: string;
}

export interface AnalyticsStore {
  /**
   * Enqueue a batch of webhook events for persistence.
   *
   * Synchronous fire-and-forget contract: MUST NOT block the caller and MUST
   * NOT throw. The SQLite implementation writes inline in a transaction; the
   * Postgres implementation enqueues into an async write buffer.
   */
  recordBatch(payloads: LiteLLMWebhookPayload[]): void;

  /** Aggregate summary analytics for a date range. */
  getSummary(opts: SummaryOptions): Promise<AnalyticsSummary>;

  /** Time-series data for charts (hourly / daily / weekly). */
  getTimeSeries(opts: TimeSeriesOptions): Promise<TimeSeriesPoint[]>;

  /** Per-model breakdown including latency percentiles. */
  getModelBreakdown(opts: ModelBreakdownOptions): Promise<ModelBreakdown[]>;

  /** Per-session cost attribution. */
  getSessionAttribution(
    opts: SessionAttributionOptions
  ): Promise<SessionAttribution[]>;

  /** Latency percentiles per model. */
  getLatencyPercentiles(
    opts: LatencyPercentilesOptions
  ): Promise<LatencyPercentiles[]>;

  /**
   * Prune raw request logs older than the retention window (default 90 days).
   * Daily aggregates are retained indefinitely.
   */
  pruneOldLogs(retentionDays?: number): Promise<{ deletedCount: number }>;

  /**
   * Flush any buffered writes to durable storage. No-op on SQLite; drains the
   * async write buffer on Postgres. Called during graceful shutdown.
   */
  flush(): Promise<void>;
}
