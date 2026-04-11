/**
 * LiteLLM Analytics Service
 *
 * Handles writing and reading LiteLLM usage analytics data.
 * Uses a separate SQLite analytics database (following the LogDatabase pattern)
 * with better-sqlite3 for synchronous operations.
 */

import { createLogger } from "@/lib/logger";
import { getAnalyticsDatabase } from "@/infrastructure/analytics/AnalyticsDatabase";
import type {
  LiteLLMWebhookPayload,
  TimeSeriesPoint,
  ModelBreakdown,
  SessionAttribution,
  LatencyPercentiles,
} from "@/types/litellm";

const log = createLogger("LiteLLMAnalytics");

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface AnalyticsSummary {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  periodStart: string;
  periodEnd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a timestamp that may be ISO-8601, epoch-seconds, or epoch-ms. */
function normalizeTime(t: string | number): number {
  if (typeof t === "number") return t > 1e12 ? t : t * 1000;
  return new Date(t).getTime();
}

/** Format a Date as YYYY-MM-DD for daily-agg keys. */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute a percentile value from a pre-sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

const MAX_LATENCY_SAMPLES = 1000;

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

/**
 * Record a single LiteLLM webhook event.
 * Delegates to recordBatch for consistent prepared-statement reuse.
 */
export function recordRequest(payload: LiteLLMWebhookPayload): void {
  recordBatch([payload]);
}

/**
 * Record a batch of webhook events (LiteLLM may send arrays).
 * Wrapped in a single SQLite transaction for performance.
 */
export function recordBatch(payloads: LiteLLMWebhookPayload[]): void {
  if (payloads.length === 0) return;

  const db = getAnalyticsDatabase();

  const insertLog = db.prepare(
    `INSERT OR IGNORE INTO litellm_request_log (
      id, model, model_group, api_base,
      prompt_tokens, completion_tokens, total_tokens,
      cache_creation_input_tokens, cache_read_input_tokens,
      response_cost, saved_cache_cost,
      start_time_ms, end_time_ms, duration_ms, completion_start_ms,
      status, error_str,
      session_id, end_user, api_key_hash, api_key_alias, requester_ip,
      cache_hit, raw_metadata, requested_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )`
  );

  const selectSamples = db.prepare(
    `SELECT latency_samples FROM litellm_daily_agg WHERE id = ?`
  );

  const upsertAgg = db.prepare(
    `INSERT INTO litellm_daily_agg (
      id, date, model,
      request_count, success_count, failure_count,
      total_prompt_tokens, total_completion_tokens, total_tokens,
      total_cost, total_saved_cache_cost, total_duration_ms,
      latency_samples, updated_at
    ) VALUES (
      ?, ?, ?,
      1, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(date, model) DO UPDATE SET
      request_count           = request_count + 1,
      success_count           = success_count + excluded.success_count,
      failure_count           = failure_count + excluded.failure_count,
      total_prompt_tokens     = total_prompt_tokens + excluded.total_prompt_tokens,
      total_completion_tokens = total_completion_tokens + excluded.total_completion_tokens,
      total_tokens            = total_tokens + excluded.total_tokens,
      total_cost              = total_cost + excluded.total_cost,
      total_saved_cache_cost  = total_saved_cache_cost + excluded.total_saved_cache_cost,
      total_duration_ms       = total_duration_ms + excluded.total_duration_ms,
      latency_samples         = ?,
      updated_at              = ?`
  );

  // Track in-flight sample arrays within the batch so successive records for
  // the same (date, model) in one batch accumulate correctly.
  const sampleCache = new Map<string, number[]>();

  const txn = db.transaction(() => {
    const now = Date.now();

    for (const payload of payloads) {
      const promptTokens =
        payload.usage?.prompt_tokens ?? payload.prompt_tokens ?? 0;
      const completionTokens =
        payload.usage?.completion_tokens ?? payload.completion_tokens ?? 0;
      const totalTokens =
        payload.usage?.total_tokens ?? payload.total_tokens ?? 0;
      const cacheCreationTokens =
        payload.usage?.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = payload.usage?.cache_read_input_tokens ?? 0;
      const responseCost = payload.response_cost ?? 0;
      const savedCacheCost = payload.saved_cache_cost ?? 0;

      const startMs = normalizeTime(payload.startTime);
      const endMs = normalizeTime(payload.endTime);
      const durationMs = endMs - startMs;
      const completionStartMs = payload.completionStartTime
        ? normalizeTime(payload.completionStartTime)
        : null;

      const status = payload.status ?? "success";
      const isSuccess = status === "success" ? 1 : 0;
      const isFailure = status !== "success" ? 1 : 0;

      const sessionId =
        payload.metadata?.headers?.["x-claude-code-session-id"] ?? null;
      const cacheHit = payload.cache_hit ? 1 : 0;

      const model = payload.model;
      const dateStr = new Date(startMs).toISOString().slice(0, 10);
      const aggId = `${dateStr}:${model}`;

      // Insert request log
      insertLog.run(
        payload.id,
        model,
        payload.model_group ?? null,
        payload.api_base ?? null,
        promptTokens,
        completionTokens,
        totalTokens,
        cacheCreationTokens,
        cacheReadTokens,
        responseCost,
        savedCacheCost,
        startMs,
        endMs,
        durationMs,
        completionStartMs,
        status,
        payload.error_str ?? null,
        sessionId,
        payload.end_user ?? null,
        payload.user_api_key_hash ?? null,
        payload.user_api_key_alias ?? null,
        payload.requester_ip_address ?? null,
        cacheHit,
        payload.metadata ? JSON.stringify(payload.metadata) : null,
        startMs
      );

      // Build latency samples (use cache for batch coherence)
      let samples: number[];
      if (sampleCache.has(aggId)) {
        samples = sampleCache.get(aggId)!;
      } else {
        const existing = selectSamples.get(aggId) as
          | { latency_samples: string }
          | undefined;
        samples = existing ? JSON.parse(existing.latency_samples) : [];
        sampleCache.set(aggId, samples);
      }
      if (samples.length < MAX_LATENCY_SAMPLES) {
        samples.push(durationMs);
      }
      const newSamples = JSON.stringify(samples);

      // Upsert daily aggregate
      upsertAgg.run(
        aggId,
        dateStr,
        model,
        isSuccess,
        isFailure,
        promptTokens,
        completionTokens,
        totalTokens,
        responseCost,
        savedCacheCost,
        durationMs,
        newSamples,
        now,
        // ON CONFLICT params
        newSamples,
        now
      );
    }
  });

  try {
    txn();
    log.debug("Recorded batch", { count: payloads.length });
  } catch (err) {
    log.error("Failed to record batch", {
      error: String(err),
      count: payloads.length,
    });
  }
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/**
 * Get summary analytics for a date range.
 */
export function getSummary(opts: {
  startDate: Date;
  endDate: Date;
  model?: string;
}): AnalyticsSummary {
  const db = getAnalyticsDatabase();
  const start = toDateStr(opts.startDate);
  const end = toDateStr(opts.endDate);

  let sql = `
    SELECT
      COALESCE(SUM(request_count), 0)  AS totalRequests,
      COALESCE(SUM(total_cost), 0)     AS totalCost,
      COALESCE(SUM(total_tokens), 0)   AS totalTokens,
      COALESCE(SUM(total_duration_ms), 0) AS totalDuration,
      COALESCE(SUM(success_count), 0)  AS successCount
    FROM litellm_daily_agg
    WHERE date >= ? AND date <= ?
  `;
  const params: (string | number)[] = [start, end];

  if (opts.model) {
    sql += ` AND model = ?`;
    params.push(opts.model);
  }

  const row = db.prepare(sql).get(...params) as {
    totalRequests: number;
    totalCost: number;
    totalTokens: number;
    totalDuration: number;
    successCount: number;
  };

  return {
    totalRequests: row.totalRequests,
    totalCost: row.totalCost,
    totalTokens: row.totalTokens,
    avgLatencyMs:
      row.totalRequests > 0 ? row.totalDuration / row.totalRequests : 0,
    successRate:
      row.totalRequests > 0 ? row.successCount / row.totalRequests : 0,
    periodStart: start,
    periodEnd: end,
  };
}

/**
 * Get time-series data for charts.
 * Daily granularity reads from litellm_daily_agg (fast).
 * Hourly granularity reads from litellm_request_log.
 */
export function getTimeSeries(opts: {
  startDate: Date;
  endDate: Date;
  granularity: "hourly" | "daily" | "weekly";
  model?: string;
  splitByModel?: boolean;
}): TimeSeriesPoint[] {
  const db = getAnalyticsDatabase();
  const start = toDateStr(opts.startDate);
  const end = toDateStr(opts.endDate);
  const startMs = opts.startDate.getTime();
  const endMs = opts.endDate.getTime();

  if (opts.granularity === "hourly") {
    // Query litellm_request_log directly
    const modelCol = opts.splitByModel ? "model" : "NULL";
    let sql = `
      SELECT
        strftime('%Y-%m-%d %H:00', datetime(requested_at / 1000, 'unixepoch')) AS date,
        ${modelCol} AS model,
        COUNT(*)                          AS requestCount,
        COALESCE(SUM(total_tokens), 0)    AS totalTokens,
        COALESCE(SUM(response_cost), 0)   AS totalCost,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCount,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failureCount,
        COALESCE(AVG(duration_ms), 0)     AS avgDurationMs
      FROM litellm_request_log
      WHERE requested_at >= ? AND requested_at <= ?
    `;
    const params: (string | number)[] = [startMs, endMs];

    if (opts.model) {
      sql += ` AND model = ?`;
      params.push(opts.model);
    }

    sql += ` GROUP BY date`;
    if (opts.splitByModel) sql += `, model`;
    sql += ` ORDER BY date`;

    return db.prepare(sql).all(...params) as TimeSeriesPoint[];
  }

  // Daily or weekly — read from litellm_daily_agg
  const dateExpr =
    opts.granularity === "weekly"
      ? `strftime('%Y-W%W', date)`
      : "date";

  const modelCol = opts.splitByModel ? "model" : "NULL";

  let sql = `
    SELECT
      ${dateExpr}                                AS date,
      ${modelCol}                                AS model,
      COALESCE(SUM(request_count), 0)            AS requestCount,
      COALESCE(SUM(total_tokens), 0)             AS totalTokens,
      COALESCE(SUM(total_cost), 0)               AS totalCost,
      COALESCE(SUM(success_count), 0)            AS successCount,
      COALESCE(SUM(failure_count), 0)            AS failureCount,
      CASE WHEN SUM(request_count) > 0
        THEN SUM(total_duration_ms) * 1.0 / SUM(request_count)
        ELSE 0
      END                                        AS avgDurationMs
    FROM litellm_daily_agg
    WHERE date >= ? AND date <= ?
  `;
  const params: (string | number)[] = [start, end];

  if (opts.model) {
    sql += ` AND model = ?`;
    params.push(opts.model);
  }

  sql += ` GROUP BY ${dateExpr}`;
  if (opts.splitByModel) sql += `, model`;
  sql += ` ORDER BY date`;

  return db.prepare(sql).all(...params) as TimeSeriesPoint[];
}

/**
 * Get per-model breakdown.
 */
export function getModelBreakdown(opts: {
  startDate: Date;
  endDate: Date;
}): ModelBreakdown[] {
  const db = getAnalyticsDatabase();
  const start = toDateStr(opts.startDate);
  const end = toDateStr(opts.endDate);

  const rows = db
    .prepare(
      `SELECT
        model,
        COALESCE(SUM(request_count), 0)            AS requestCount,
        COALESCE(SUM(total_prompt_tokens), 0)       AS totalPromptTokens,
        COALESCE(SUM(total_completion_tokens), 0)   AS totalCompletionTokens,
        COALESCE(SUM(total_tokens), 0)              AS totalTokens,
        COALESCE(SUM(total_cost), 0)                AS totalCost,
        COALESCE(SUM(success_count), 0)             AS successCount,
        COALESCE(SUM(total_duration_ms), 0)         AS totalDuration,
        GROUP_CONCAT(latency_samples, ',')          AS allSamples
      FROM litellm_daily_agg
      WHERE date >= ? AND date <= ?
      GROUP BY model
      ORDER BY totalCost DESC`
    )
    .all(start, end) as Array<{
    model: string;
    requestCount: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCost: number;
    successCount: number;
    totalDuration: number;
    allSamples: string | null;
  }>;

  return rows.map((row) => {
    const sorted = parseConcatenatedSamples(row.allSamples);
    return {
      model: row.model,
      requestCount: row.requestCount,
      totalPromptTokens: row.totalPromptTokens,
      totalCompletionTokens: row.totalCompletionTokens,
      totalTokens: row.totalTokens,
      totalCost: row.totalCost,
      successRate:
        row.requestCount > 0 ? row.successCount / row.requestCount : 0,
      avgDurationMs:
        row.requestCount > 0 ? row.totalDuration / row.requestCount : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
    };
  });
}

/**
 * Get per-session cost attribution.
 */
export function getSessionAttribution(opts: {
  startDate: Date;
  endDate: Date;
  limit?: number;
}): SessionAttribution[] {
  const db = getAnalyticsDatabase();
  const startMs = opts.startDate.getTime();
  const endMs = opts.endDate.getTime();
  const limit = opts.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT
        session_id                          AS sessionId,
        COUNT(*)                            AS requestCount,
        COALESCE(SUM(total_tokens), 0)      AS totalTokens,
        COALESCE(SUM(response_cost), 0)     AS totalCost,
        MAX(requested_at)                   AS lastRequestAt
      FROM litellm_request_log
      WHERE requested_at >= ? AND requested_at <= ?
        AND session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY totalCost DESC
      LIMIT ?`
    )
    .all(startMs, endMs, limit) as Array<{
    sessionId: string;
    requestCount: number;
    totalTokens: number;
    totalCost: number;
    lastRequestAt: number;
  }>;

  return rows.map((row) => ({
    sessionId: row.sessionId,
    requestCount: row.requestCount,
    totalTokens: row.totalTokens,
    totalCost: row.totalCost,
    lastRequestAt: new Date(row.lastRequestAt),
  }));
}

/**
 * Get latency percentiles per model.
 */
export function getLatencyPercentiles(opts: {
  startDate: Date;
  endDate: Date;
  model?: string;
}): LatencyPercentiles[] {
  const db = getAnalyticsDatabase();
  const start = toDateStr(opts.startDate);
  const end = toDateStr(opts.endDate);

  let sql = `
    SELECT
      model,
      COALESCE(SUM(request_count), 0)       AS requestCount,
      COALESCE(SUM(total_duration_ms), 0)    AS totalDuration,
      GROUP_CONCAT(latency_samples, ',')     AS allSamples
    FROM litellm_daily_agg
    WHERE date >= ? AND date <= ?
  `;
  const params: (string | number)[] = [start, end];

  if (opts.model) {
    sql += ` AND model = ?`;
    params.push(opts.model);
  }

  sql += ` GROUP BY model ORDER BY model`;

  const rows = db.prepare(sql).all(...params) as Array<{
    model: string;
    requestCount: number;
    totalDuration: number;
    allSamples: string | null;
  }>;

  return rows.map((row) => {
    const sorted = parseConcatenatedSamples(row.allSamples);
    return {
      model: row.model,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      avgDurationMs:
        row.requestCount > 0 ? row.totalDuration / row.requestCount : 0,
      sampleCount: sorted.length,
    };
  });
}

/**
 * Prune old request logs (default 90 days).
 * Daily aggregates are kept indefinitely (small footprint).
 */
export function pruneOldLogs(retentionDays = 90): { deletedCount: number } {
  const db = getAnalyticsDatabase();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const result = db
    .prepare(`DELETE FROM litellm_request_log WHERE requested_at < ?`)
    .run(cutoff);

  const deletedCount = result.changes;
  if (deletedCount > 0) {
    log.info("Pruned old request logs", { deletedCount, retentionDays });
  }

  return { deletedCount };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse latency samples from GROUP_CONCAT'd JSON arrays.
 *
 * GROUP_CONCAT joins individual row values with commas, so for rows containing
 * "[100,200]" and "[300]" we get the string "[100,200],[300]".
 * We wrap it in an outer array to produce valid JSON: "[[100,200],[300]]",
 * then flatten.
 */
function parseConcatenatedSamples(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const arrays: number[][] = JSON.parse(`[${raw}]`);
    const flat = arrays.flat();
    flat.sort((a, b) => a - b);
    return flat;
  } catch {
    log.warn("Failed to parse latency samples", {
      samplePreview: raw.slice(0, 100),
    });
    return [];
  }
}
