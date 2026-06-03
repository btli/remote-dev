/**
 * PgAnalyticsStore - Postgres implementation of the AnalyticsStore port.
 *
 * Writes are async-buffered: `recordBatch()` enqueues webhook payloads into a
 * PgWriteBuffer and returns immediately. The buffer flushes batches by:
 *   1. inserting raw request logs into `analytics.litellm_request_log` via a
 *      single multi-row UNNEST INSERT with `ON CONFLICT (id) DO NOTHING`
 *      (the Postgres equivalent of SQLite `INSERT OR IGNORE`).
 *   2. upserting daily aggregates into `analytics.litellm_daily_agg`
 *      (`ON CONFLICT (date, model) DO UPDATE` adding counts/costs and merging
 *      JSONB `latency_samples`, capped at MAX_LATENCY_SAMPLES elements).
 *
 * Reads are async pg queries that rewrite the SQLite-only SQL (strftime,
 * GROUP_CONCAT) into Postgres equivalents (to_char / to_timestamp, jsonb_agg).
 * Percentile computation is identical to the SQLite path (same TS logic over a
 * flattened, sorted number[]).
 */

import { createLogger } from "@/lib/logger";
import type {
  AnalyticsStore,
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
import type { PoolClient } from "pg";
import { getSidecarPool } from "./sidecar-db";
import { PgWriteBuffer } from "./PgWriteBuffer";

const log = createLogger("PgAnalyticsStore");

const MAX_LATENCY_SAMPLES = 1000;

// ---------------------------------------------------------------------------
// Helpers (shared semantics with the SQLite store)
// ---------------------------------------------------------------------------

/** Normalise a timestamp that may be ISO-8601, epoch-seconds, or epoch-ms. */
function normalizeTime(t: string | number): number {
  if (typeof t === "number") return t > 1e12 ? t : t * 1000;
  return new Date(t).getTime();
}

/** Format a Date as YYYY-MM-DD for daily-agg keys / date-range bounds. */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute a percentile value from a pre-sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Coerce a pg numeric/bigint column (returned as string) to a JS number. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

/**
 * Flatten an array of latency-sample arrays (one per daily-agg row, as returned
 * by `jsonb_agg(latency_samples)`) into a single sorted number[].
 */
function flattenSamples(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const flat: number[] = [];
  for (const arr of raw) {
    if (Array.isArray(arr)) {
      for (const n of arr) {
        const v = Number(n);
        if (!Number.isNaN(v)) flat.push(v);
      }
    }
  }
  flat.sort((a, b) => a - b);
  return flat;
}

// ---------------------------------------------------------------------------
// Buffered-write shapes
// ---------------------------------------------------------------------------

interface RequestLogRow {
  id: string;
  model: string;
  modelGroup: string | null;
  apiBase: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  responseCost: number;
  savedCacheCost: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  completionStartMs: number | null;
  status: string;
  errorStr: string | null;
  sessionId: string | null;
  endUser: string | null;
  apiKeyHash: string | null;
  apiKeyAlias: string | null;
  requesterIp: string | null;
  cacheHit: boolean;
  rawMetadata: string | null;
  requestedAt: number;
  // Derived aggregation fields
  dateStr: string;
  isSuccess: number;
  isFailure: number;
}

export class PgAnalyticsStore implements AnalyticsStore {
  private readonly buffer: PgWriteBuffer<RequestLogRow>;

  constructor() {
    this.buffer = new PgWriteBuffer<RequestLogRow>(
      (items) => this.flushBatch(items),
      { name: "analytics" }
    );
  }

  recordBatch(payloads: LiteLLMWebhookPayload[]): void {
    if (payloads.length === 0) return;
    const rows = payloads.map((p) => this.toRow(p));
    this.buffer.enqueue(rows);
  }

  /** Map a webhook payload to the buffered row shape (matches SQLite mapping). */
  private toRow(payload: LiteLLMWebhookPayload): RequestLogRow {
    const promptTokens =
      payload.usage?.prompt_tokens ?? payload.prompt_tokens ?? 0;
    const completionTokens =
      payload.usage?.completion_tokens ?? payload.completion_tokens ?? 0;
    const totalTokens =
      payload.usage?.total_tokens ?? payload.total_tokens ?? 0;
    const cacheCreationTokens = payload.usage?.cache_creation_input_tokens ?? 0;
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
    const sessionId =
      payload.metadata?.headers?.["x-claude-code-session-id"] ?? null;

    return {
      id: payload.id,
      model: payload.model,
      modelGroup: payload.model_group ?? null,
      apiBase: payload.api_base ?? null,
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
      errorStr: payload.error_str ?? null,
      sessionId,
      endUser: payload.end_user ?? null,
      apiKeyHash: payload.user_api_key_hash ?? null,
      apiKeyAlias: payload.user_api_key_alias ?? null,
      requesterIp: payload.requester_ip_address ?? null,
      cacheHit: Boolean(payload.cache_hit),
      rawMetadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      requestedAt: startMs,
      dateStr: new Date(startMs).toISOString().slice(0, 10),
      isSuccess: status === "success" ? 1 : 0,
      isFailure: status !== "success" ? 1 : 0,
    };
  }

  /**
   * Flush a drained batch: insert raw request logs, then upsert daily
   * aggregates. Throws on error so the buffer drops + reports (no blocking).
   */
  private async flushBatch(items: RequestLogRow[]): Promise<void> {
    if (items.length === 0) return;
    const pool = getSidecarPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await this.insertRequestLogs(client, items);
      await this.upsertDailyAggregates(client, items);
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Multi-row UNNEST insert with ON CONFLICT (id) DO NOTHING. */
  private async insertRequestLogs(
    client: PoolClient,
    items: RequestLogRow[]
  ): Promise<void> {
    const cols: Record<keyof RequestLogRow, unknown[]> = {
      id: [],
      model: [],
      modelGroup: [],
      apiBase: [],
      promptTokens: [],
      completionTokens: [],
      totalTokens: [],
      cacheCreationTokens: [],
      cacheReadTokens: [],
      responseCost: [],
      savedCacheCost: [],
      startMs: [],
      endMs: [],
      durationMs: [],
      completionStartMs: [],
      status: [],
      errorStr: [],
      sessionId: [],
      endUser: [],
      apiKeyHash: [],
      apiKeyAlias: [],
      requesterIp: [],
      cacheHit: [],
      rawMetadata: [],
      requestedAt: [],
      dateStr: [],
      isSuccess: [],
      isFailure: [],
    };
    for (const r of items) {
      cols.id.push(r.id);
      cols.model.push(r.model);
      cols.modelGroup.push(r.modelGroup);
      cols.apiBase.push(r.apiBase);
      cols.promptTokens.push(r.promptTokens);
      cols.completionTokens.push(r.completionTokens);
      cols.totalTokens.push(r.totalTokens);
      cols.cacheCreationTokens.push(r.cacheCreationTokens);
      cols.cacheReadTokens.push(r.cacheReadTokens);
      cols.responseCost.push(r.responseCost);
      cols.savedCacheCost.push(r.savedCacheCost);
      cols.startMs.push(r.startMs);
      cols.endMs.push(r.endMs);
      cols.durationMs.push(r.durationMs);
      cols.completionStartMs.push(r.completionStartMs);
      cols.status.push(r.status);
      cols.errorStr.push(r.errorStr);
      cols.sessionId.push(r.sessionId);
      cols.endUser.push(r.endUser);
      cols.apiKeyHash.push(r.apiKeyHash);
      cols.apiKeyAlias.push(r.apiKeyAlias);
      cols.requesterIp.push(r.requesterIp);
      cols.cacheHit.push(r.cacheHit);
      cols.rawMetadata.push(r.rawMetadata);
      cols.requestedAt.push(r.requestedAt);
    }

    await client.query(
      `INSERT INTO analytics.litellm_request_log (
         id, model, model_group, api_base,
         prompt_tokens, completion_tokens, total_tokens,
         cache_creation_input_tokens, cache_read_input_tokens,
         response_cost, saved_cache_cost,
         start_time_ms, end_time_ms, duration_ms, completion_start_ms,
         status, error_str,
         session_id, end_user, api_key_hash, api_key_alias, requester_ip,
         cache_hit, raw_metadata, requested_at
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[],
         $5::bigint[], $6::bigint[], $7::bigint[],
         $8::bigint[], $9::bigint[],
         $10::double precision[], $11::double precision[],
         $12::bigint[], $13::bigint[], $14::bigint[], $15::bigint[],
         $16::text[], $17::text[],
         $18::text[], $19::text[], $20::text[], $21::text[], $22::text[],
         $23::boolean[], $24::text[], $25::bigint[]
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        cols.id,
        cols.model,
        cols.modelGroup,
        cols.apiBase,
        cols.promptTokens,
        cols.completionTokens,
        cols.totalTokens,
        cols.cacheCreationTokens,
        cols.cacheReadTokens,
        cols.responseCost,
        cols.savedCacheCost,
        cols.startMs,
        cols.endMs,
        cols.durationMs,
        cols.completionStartMs,
        cols.status,
        cols.errorStr,
        cols.sessionId,
        cols.endUser,
        cols.apiKeyHash,
        cols.apiKeyAlias,
        cols.requesterIp,
        cols.cacheHit,
        cols.rawMetadata,
        cols.requestedAt,
      ]
    );
  }

  /**
   * Pre-aggregate the batch by (date, model) in JS, then issue one upsert per
   * group. ON CONFLICT (date, model) DO UPDATE adds counts/costs and merges the
   * JSONB latency_samples, capping the merged array at MAX_LATENCY_SAMPLES.
   *
   * Pre-aggregating in JS keeps the SQLite per-row semantics: a request that
   * arrives when the daily array already holds >= MAX_LATENCY_SAMPLES does not
   * append; the cap is applied to the merged result on conflict.
   */
  private async upsertDailyAggregates(
    client: PoolClient,
    items: RequestLogRow[]
  ): Promise<void> {
    interface Group {
      date: string;
      model: string;
      requestCount: number;
      successCount: number;
      failureCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      totalCost: number;
      totalSavedCacheCost: number;
      totalDurationMs: number;
      samples: number[];
    }
    const groups = new Map<string, Group>();
    for (const r of items) {
      const key = `${r.dateStr}:${r.model}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          date: r.dateStr,
          model: r.model,
          requestCount: 0,
          successCount: 0,
          failureCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          totalSavedCacheCost: 0,
          totalDurationMs: 0,
          samples: [],
        };
        groups.set(key, g);
      }
      g.requestCount += 1;
      g.successCount += r.isSuccess;
      g.failureCount += r.isFailure;
      g.promptTokens += r.promptTokens;
      g.completionTokens += r.completionTokens;
      g.totalTokens += r.totalTokens;
      g.totalCost += r.responseCost;
      g.totalSavedCacheCost += r.savedCacheCost;
      g.totalDurationMs += r.durationMs;
      if (g.samples.length < MAX_LATENCY_SAMPLES) g.samples.push(r.durationMs);
    }

    const now = Date.now();
    for (const g of groups.values()) {
      const aggId = `${g.date}:${g.model}`;
      await client.query(
        `INSERT INTO analytics.litellm_daily_agg (
           id, date, model,
           request_count, success_count, failure_count,
           total_prompt_tokens, total_completion_tokens, total_tokens,
           total_cost, total_saved_cache_cost, total_duration_ms,
           latency_samples, updated_at
         ) VALUES (
           $1, $2::date, $3,
           $4, $5, $6,
           $7, $8, $9,
           $10, $11, $12,
           $13::jsonb, $14
         )
         ON CONFLICT (date, model) DO UPDATE SET
           request_count           = analytics.litellm_daily_agg.request_count + EXCLUDED.request_count,
           success_count           = analytics.litellm_daily_agg.success_count + EXCLUDED.success_count,
           failure_count           = analytics.litellm_daily_agg.failure_count + EXCLUDED.failure_count,
           total_prompt_tokens     = analytics.litellm_daily_agg.total_prompt_tokens + EXCLUDED.total_prompt_tokens,
           total_completion_tokens = analytics.litellm_daily_agg.total_completion_tokens + EXCLUDED.total_completion_tokens,
           total_tokens            = analytics.litellm_daily_agg.total_tokens + EXCLUDED.total_tokens,
           total_cost              = analytics.litellm_daily_agg.total_cost + EXCLUDED.total_cost,
           total_saved_cache_cost  = analytics.litellm_daily_agg.total_saved_cache_cost + EXCLUDED.total_saved_cache_cost,
           total_duration_ms       = analytics.litellm_daily_agg.total_duration_ms + EXCLUDED.total_duration_ms,
           latency_samples         = (
             SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
             FROM (
               SELECT elem
               FROM jsonb_array_elements(
                 analytics.litellm_daily_agg.latency_samples || EXCLUDED.latency_samples
               ) AS elem
               LIMIT ${MAX_LATENCY_SAMPLES}
             ) capped
           ),
           updated_at              = EXCLUDED.updated_at`,
        [
          aggId,
          g.date,
          g.model,
          g.requestCount,
          g.successCount,
          g.failureCount,
          g.promptTokens,
          g.completionTokens,
          g.totalTokens,
          g.totalCost,
          g.totalSavedCacheCost,
          g.totalDurationMs,
          JSON.stringify(g.samples),
          now,
        ]
      );
    }
  }

  // -------------------------------------------------------------------------
  // Read path
  // -------------------------------------------------------------------------

  async getSummary(opts: SummaryOptions): Promise<AnalyticsSummary> {
    const start = toDateStr(opts.startDate);
    const end = toDateStr(opts.endDate);

    const params: (string | number)[] = [start, end];
    let sql = `
      SELECT
        COALESCE(SUM(request_count), 0)     AS "totalRequests",
        COALESCE(SUM(total_cost), 0)        AS "totalCost",
        COALESCE(SUM(total_tokens), 0)      AS "totalTokens",
        COALESCE(SUM(total_duration_ms), 0) AS "totalDuration",
        COALESCE(SUM(success_count), 0)     AS "successCount"
      FROM analytics.litellm_daily_agg
      WHERE date >= $1::date AND date <= $2::date
    `;
    if (opts.model) {
      params.push(opts.model);
      sql += ` AND model = $${params.length}`;
    }

    const { rows } = await getSidecarPool().query(sql, params);
    const row = rows[0] ?? {};
    const totalRequests = num(row.totalRequests);
    const totalDuration = num(row.totalDuration);
    const successCount = num(row.successCount);

    return {
      totalRequests,
      totalCost: num(row.totalCost),
      totalTokens: num(row.totalTokens),
      avgLatencyMs: totalRequests > 0 ? totalDuration / totalRequests : 0,
      successRate: totalRequests > 0 ? successCount / totalRequests : 0,
      periodStart: start,
      periodEnd: end,
    };
  }

  async getTimeSeries(opts: TimeSeriesOptions): Promise<TimeSeriesPoint[]> {
    const start = toDateStr(opts.startDate);
    const end = toDateStr(opts.endDate);
    const startMs = opts.startDate.getTime();
    const endMs = opts.endDate.getTime();

    if (opts.granularity === "hourly") {
      // Read litellm_request_log directly.
      // SQLite: strftime('%Y-%m-%d %H:00', datetime(requested_at/1000,'unixepoch'))
      // Postgres: to_char(to_timestamp(requested_at/1000.0),'YYYY-MM-DD HH24:00')
      const modelCol = opts.splitByModel ? "model" : "NULL";
      const params: (string | number)[] = [startMs, endMs];
      let sql = `
        SELECT
          to_char(to_timestamp(requested_at / 1000.0), 'YYYY-MM-DD HH24:00') AS date,
          ${modelCol} AS model,
          COUNT(*)                          AS "requestCount",
          COALESCE(SUM(total_tokens), 0)    AS "totalTokens",
          COALESCE(SUM(response_cost), 0)   AS "totalCost",
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS "successCount",
          SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS "failureCount",
          COALESCE(AVG(duration_ms), 0)     AS "avgDurationMs"
        FROM analytics.litellm_request_log
        WHERE requested_at >= $1 AND requested_at <= $2
      `;
      if (opts.model) {
        params.push(opts.model);
        sql += ` AND model = $${params.length}`;
      }
      sql += ` GROUP BY date`;
      if (opts.splitByModel) sql += `, model`;
      sql += ` ORDER BY date`;

      const { rows } = await getSidecarPool().query(sql, params);
      return rows.map((r) => this.toTimeSeriesPoint(r));
    }

    // Daily or weekly — read from litellm_daily_agg.
    // SQLite weekly: strftime('%Y-W%W', date)
    // Postgres weekly: to_char(date::date, 'IYYY"-W"IW')
    //   NOTE: SQLite %W (0-53, week starts Monday, days before the first Monday
    //   are week 00) and Postgres IW (ISO 8601 week, 01-53) differ at
    //   year-boundary weeks. Bucket *labels* may therefore differ slightly
    //   between backends around Jan 1; aggregation is otherwise equivalent.
    const dateExpr =
      opts.granularity === "weekly"
        ? `to_char(date::date, 'IYYY"-W"IW')`
        : `to_char(date, 'YYYY-MM-DD')`;
    const modelCol = opts.splitByModel ? "model" : "NULL";

    const params: (string | number)[] = [start, end];
    let sql = `
      SELECT
        ${dateExpr}                                AS date,
        ${modelCol}                                AS model,
        COALESCE(SUM(request_count), 0)            AS "requestCount",
        COALESCE(SUM(total_tokens), 0)             AS "totalTokens",
        COALESCE(SUM(total_cost), 0)               AS "totalCost",
        COALESCE(SUM(success_count), 0)            AS "successCount",
        COALESCE(SUM(failure_count), 0)            AS "failureCount",
        CASE WHEN SUM(request_count) > 0
          THEN SUM(total_duration_ms) * 1.0 / SUM(request_count)
          ELSE 0
        END                                        AS "avgDurationMs"
      FROM analytics.litellm_daily_agg
      WHERE date >= $1::date AND date <= $2::date
    `;
    if (opts.model) {
      params.push(opts.model);
      sql += ` AND model = $${params.length}`;
    }
    sql += ` GROUP BY ${dateExpr}`;
    if (opts.splitByModel) sql += `, model`;
    sql += ` ORDER BY date`;

    const { rows } = await getSidecarPool().query(sql, params);
    return rows.map((r) => this.toTimeSeriesPoint(r));
  }

  private toTimeSeriesPoint(row: Record<string, unknown>): TimeSeriesPoint {
    return {
      date: String(row.date),
      model: (row.model as string | null) ?? null,
      requestCount: num(row.requestCount),
      totalTokens: num(row.totalTokens),
      totalCost: num(row.totalCost),
      successCount: num(row.successCount),
      failureCount: num(row.failureCount),
      avgDurationMs: num(row.avgDurationMs),
    };
  }

  async getModelBreakdown(
    opts: ModelBreakdownOptions
  ): Promise<ModelBreakdown[]> {
    const start = toDateStr(opts.startDate);
    const end = toDateStr(opts.endDate);

    // SQLite: GROUP_CONCAT(latency_samples, ',') -> Postgres: jsonb_agg, flatten in app
    const { rows } = await getSidecarPool().query(
      `SELECT
         model,
         COALESCE(SUM(request_count), 0)          AS "requestCount",
         COALESCE(SUM(total_prompt_tokens), 0)     AS "totalPromptTokens",
         COALESCE(SUM(total_completion_tokens), 0) AS "totalCompletionTokens",
         COALESCE(SUM(total_tokens), 0)            AS "totalTokens",
         COALESCE(SUM(total_cost), 0)              AS "totalCost",
         COALESCE(SUM(success_count), 0)           AS "successCount",
         COALESCE(SUM(total_duration_ms), 0)       AS "totalDuration",
         jsonb_agg(latency_samples)                AS "allSamples"
       FROM analytics.litellm_daily_agg
       WHERE date >= $1::date AND date <= $2::date
       GROUP BY model
       ORDER BY "totalCost" DESC`,
      [start, end]
    );

    return rows.map((row) => {
      const sorted = flattenSamples(row.allSamples);
      const requestCount = num(row.requestCount);
      const totalDuration = num(row.totalDuration);
      const successCount = num(row.successCount);
      return {
        model: row.model as string,
        requestCount,
        totalPromptTokens: num(row.totalPromptTokens),
        totalCompletionTokens: num(row.totalCompletionTokens),
        totalTokens: num(row.totalTokens),
        totalCost: num(row.totalCost),
        successRate: requestCount > 0 ? successCount / requestCount : 0,
        avgDurationMs: requestCount > 0 ? totalDuration / requestCount : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
      };
    });
  }

  async getSessionAttribution(
    opts: SessionAttributionOptions
  ): Promise<SessionAttribution[]> {
    const startMs = opts.startDate.getTime();
    const endMs = opts.endDate.getTime();
    const limit = opts.limit ?? 50;

    const { rows } = await getSidecarPool().query(
      `SELECT
         session_id                       AS "sessionId",
         COUNT(*)                         AS "requestCount",
         COALESCE(SUM(total_tokens), 0)   AS "totalTokens",
         COALESCE(SUM(response_cost), 0)  AS "totalCost",
         MAX(requested_at)                AS "lastRequestAt"
       FROM analytics.litellm_request_log
       WHERE requested_at >= $1 AND requested_at <= $2
         AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY "totalCost" DESC
       LIMIT $3`,
      [startMs, endMs, limit]
    );

    return rows.map((row) => ({
      sessionId: row.sessionId as string,
      requestCount: num(row.requestCount),
      totalTokens: num(row.totalTokens),
      totalCost: num(row.totalCost),
      lastRequestAt: new Date(num(row.lastRequestAt)),
    }));
  }

  async getLatencyPercentiles(
    opts: LatencyPercentilesOptions
  ): Promise<LatencyPercentiles[]> {
    const start = toDateStr(opts.startDate);
    const end = toDateStr(opts.endDate);

    const params: (string | number)[] = [start, end];
    let sql = `
      SELECT
        model,
        COALESCE(SUM(request_count), 0)     AS "requestCount",
        COALESCE(SUM(total_duration_ms), 0) AS "totalDuration",
        jsonb_agg(latency_samples)          AS "allSamples"
      FROM analytics.litellm_daily_agg
      WHERE date >= $1::date AND date <= $2::date
    `;
    if (opts.model) {
      params.push(opts.model);
      sql += ` AND model = $${params.length}`;
    }
    sql += ` GROUP BY model ORDER BY model`;

    const { rows } = await getSidecarPool().query(sql, params);
    return rows.map((row) => {
      const sorted = flattenSamples(row.allSamples);
      const requestCount = num(row.requestCount);
      const totalDuration = num(row.totalDuration);
      return {
        model: row.model as string,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avgDurationMs: requestCount > 0 ? totalDuration / requestCount : 0,
        sampleCount: sorted.length,
      };
    });
  }

  async pruneOldLogs(retentionDays = 90): Promise<{ deletedCount: number }> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = await getSidecarPool().query(
      "DELETE FROM analytics.litellm_request_log WHERE requested_at < $1",
      [cutoff]
    );
    const deletedCount = result.rowCount ?? 0;
    if (deletedCount > 0) {
      log.info("Pruned old request logs", { deletedCount, retentionDays });
    }
    return { deletedCount };
  }

  async flush(): Promise<void> {
    await this.buffer.flush();
  }
}
