/**
 * Sidecar Postgres schema bootstrap.
 *
 * Idempotently creates the `logs` and `analytics` schemas plus their tables and
 * indexes inside the main Postgres database. Mirrors the column sets of the
 * better-sqlite3 `SCHEMA_SQL` in `LogDatabase.ts` and `AnalyticsDatabase.ts`,
 * with Postgres-native types:
 *
 *   - SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` -> `BIGSERIAL PRIMARY KEY`
 *   - epoch-ms / duration columns (`INTEGER`)     -> `BIGINT`
 *   - money columns (`REAL`)                       -> `DOUBLE PRECISION`
 *   - boolean-ish columns (`INTEGER 0/1`)          -> `BOOLEAN`
 *   - latency samples (`TEXT '[]'`)                -> `JSONB`
 *   - daily-agg `date` (`TEXT`)                     -> `DATE`
 *
 * The daily aggregate's `(date, model)` pair carries a `UNIQUE` constraint
 * (not just an index) so the analytics upsert can target it via
 * `ON CONFLICT (date, model)`.
 *
 * Run once at boot on the Postgres path (after `runMigrations()`); safe to
 * re-run (every statement is `IF NOT EXISTS`).
 */

import { getSidecarPool } from "./sidecar-db";
import { createLogger } from "@/lib/logger";

const log = createLogger("SidecarSchema");

const SCHEMA_SQL = `
  CREATE SCHEMA IF NOT EXISTS logs;
  CREATE SCHEMA IF NOT EXISTS analytics;

  CREATE TABLE IF NOT EXISTS logs.log_entry (
    id        BIGSERIAL PRIMARY KEY,
    ts        BIGINT  NOT NULL,
    level     TEXT    NOT NULL,
    namespace TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    data      TEXT,
    source    TEXT    NOT NULL DEFAULT 'nextjs'
  );
  CREATE INDEX IF NOT EXISTS idx_log_ts        ON logs.log_entry (ts DESC);
  CREATE INDEX IF NOT EXISTS idx_log_level     ON logs.log_entry (level);
  CREATE INDEX IF NOT EXISTS idx_log_namespace ON logs.log_entry (namespace);

  CREATE TABLE IF NOT EXISTS analytics.litellm_request_log (
    id                          TEXT             PRIMARY KEY,
    model                       TEXT             NOT NULL,
    model_group                 TEXT,
    api_base                    TEXT,
    prompt_tokens               BIGINT           NOT NULL DEFAULT 0,
    completion_tokens           BIGINT           NOT NULL DEFAULT 0,
    total_tokens                BIGINT           NOT NULL DEFAULT 0,
    cache_creation_input_tokens BIGINT           DEFAULT 0,
    cache_read_input_tokens     BIGINT           DEFAULT 0,
    response_cost               DOUBLE PRECISION NOT NULL DEFAULT 0,
    saved_cache_cost            DOUBLE PRECISION DEFAULT 0,
    start_time_ms               BIGINT           NOT NULL,
    end_time_ms                 BIGINT           NOT NULL,
    duration_ms                 BIGINT           NOT NULL,
    completion_start_ms         BIGINT,
    status                      TEXT             NOT NULL DEFAULT 'success',
    error_str                   TEXT,
    session_id                  TEXT,
    end_user                    TEXT,
    api_key_hash                TEXT,
    api_key_alias               TEXT,
    requester_ip                TEXT,
    cache_hit                   BOOLEAN          DEFAULT FALSE,
    raw_metadata                TEXT,
    requested_at                BIGINT           NOT NULL
  );

  CREATE INDEX IF NOT EXISTS llm_log_requested_at_idx ON analytics.litellm_request_log (requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_model_time_idx   ON analytics.litellm_request_log (model, requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_session_time_idx ON analytics.litellm_request_log (session_id, requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_status_time_idx  ON analytics.litellm_request_log (status, requested_at);

  CREATE TABLE IF NOT EXISTS analytics.litellm_daily_agg (
    id                      TEXT             PRIMARY KEY,
    date                    DATE             NOT NULL,
    model                   TEXT             NOT NULL,
    request_count           BIGINT           NOT NULL DEFAULT 0,
    success_count           BIGINT           NOT NULL DEFAULT 0,
    failure_count           BIGINT           NOT NULL DEFAULT 0,
    total_prompt_tokens     BIGINT           NOT NULL DEFAULT 0,
    total_completion_tokens BIGINT           NOT NULL DEFAULT 0,
    total_tokens            BIGINT           NOT NULL DEFAULT 0,
    total_cost              DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_saved_cache_cost  DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_duration_ms       BIGINT           NOT NULL DEFAULT 0,
    latency_samples         JSONB            NOT NULL DEFAULT '[]'::jsonb,
    updated_at              BIGINT           NOT NULL,
    CONSTRAINT llm_daily_date_model_uniq UNIQUE (date, model)
  );

  CREATE INDEX IF NOT EXISTS llm_daily_date_idx ON analytics.litellm_daily_agg (date);
`;

/**
 * Create the sidecar schemas, tables, and indexes if they do not yet exist.
 * Idempotent.
 */
export async function initSidecarSchemas(): Promise<void> {
  const pool = getSidecarPool();
  await pool.query(SCHEMA_SQL);
  log.info("Sidecar Postgres schemas ready", { schemas: ["logs", "analytics"] });
}
