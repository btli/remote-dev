/**
 * Drizzle schema definitions for the analytics database.
 *
 * Used for type-safe read queries via the Drizzle client.
 * The actual tables are created by AnalyticsDatabase.ts via raw SQL
 * (better-sqlite3 for synchronous writes).
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Raw per-request logs from LiteLLM webhook callbacks.
 * 90-day retention — pruned daily by the cron cleanup job.
 */
export const litellmRequestLog = sqliteTable(
  "litellm_request_log",
  {
    id: text("id").primaryKey(),
    model: text("model").notNull(),
    modelGroup: text("model_group"),
    apiBase: text("api_base"),

    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0),

    responseCost: real("response_cost").notNull().default(0),
    savedCacheCost: real("saved_cache_cost").default(0),

    startTimeMs: integer("start_time_ms").notNull(),
    endTimeMs: integer("end_time_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    completionStartMs: integer("completion_start_ms"),

    status: text("status").notNull().default("success"),
    errorStr: text("error_str"),

    sessionId: text("session_id"),
    endUser: text("end_user"),
    apiKeyHash: text("api_key_hash"),
    apiKeyAlias: text("api_key_alias"),
    requesterIp: text("requester_ip"),

    cacheHit: integer("cache_hit", { mode: "boolean" }).default(false),
    rawMetadata: text("raw_metadata"),

    requestedAt: integer("requested_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("llm_log_requested_at_idx").on(table.requestedAt),
    index("llm_log_model_time_idx").on(table.model, table.requestedAt),
    index("llm_log_session_time_idx").on(table.sessionId, table.requestedAt),
    index("llm_log_status_time_idx").on(table.status, table.requestedAt),
  ]
);

/**
 * Daily pre-aggregated stats.
 * Populated synchronously on each webhook write via upsert.
 * Retained indefinitely — small row count (one per model per day).
 */
export const litellmDailyAgg = sqliteTable(
  "litellm_daily_agg",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    date: text("date").notNull(),
    model: text("model").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    totalPromptTokens: integer("total_prompt_tokens").notNull().default(0),
    totalCompletionTokens: integer("total_completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    totalCost: real("total_cost").notNull().default(0),
    totalSavedCacheCost: real("total_saved_cache_cost").notNull().default(0),
    totalDurationMs: integer("total_duration_ms").notNull().default(0),
    latencySamples: text("latency_samples").notNull().default("[]"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("llm_daily_date_model_idx").on(table.date, table.model),
    index("llm_daily_date_idx").on(table.date),
  ]
);
