/**
 * AnalyticsDatabase - Singleton connection to the separate analytics SQLite database.
 *
 * Uses better-sqlite3 for synchronous writes (ideal for webhook callbacks — no dropped entries).
 * The analytics database is stored at ~/.remote-dev/analytics/analytics.db, separate from the
 * main application database to avoid polluting it with high-volume usage data.
 *
 * WAL mode enables safe concurrent writes from both the Next.js and terminal server processes.
 */

import Database from "better-sqlite3";
import { getAnalyticsDatabasePath, getAnalyticsDir } from "@/lib/paths";
import { mkdirSync } from "fs";

let _db: Database.Database | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS litellm_request_log (
    id                          TEXT    PRIMARY KEY,
    model                       TEXT    NOT NULL,
    model_group                 TEXT,
    api_base                    TEXT,
    prompt_tokens               INTEGER NOT NULL DEFAULT 0,
    completion_tokens           INTEGER NOT NULL DEFAULT 0,
    total_tokens                INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER DEFAULT 0,
    cache_read_input_tokens     INTEGER DEFAULT 0,
    response_cost               REAL    NOT NULL DEFAULT 0,
    saved_cache_cost            REAL    DEFAULT 0,
    start_time_ms               INTEGER NOT NULL,
    end_time_ms                 INTEGER NOT NULL,
    duration_ms                 INTEGER NOT NULL,
    completion_start_ms         INTEGER,
    status                      TEXT    NOT NULL DEFAULT 'success',
    error_str                   TEXT,
    session_id                  TEXT,
    end_user                    TEXT,
    api_key_hash                TEXT,
    api_key_alias               TEXT,
    requester_ip                TEXT,
    cache_hit                   INTEGER DEFAULT 0,
    raw_metadata                TEXT,
    requested_at                INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS llm_log_requested_at_idx  ON litellm_request_log(requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_model_time_idx    ON litellm_request_log(model, requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_session_time_idx  ON litellm_request_log(session_id, requested_at);
  CREATE INDEX IF NOT EXISTS llm_log_status_time_idx   ON litellm_request_log(status, requested_at);

  CREATE TABLE IF NOT EXISTS litellm_daily_agg (
    id                      TEXT    PRIMARY KEY,
    date                    TEXT    NOT NULL,
    model                   TEXT    NOT NULL,
    request_count           INTEGER NOT NULL DEFAULT 0,
    success_count           INTEGER NOT NULL DEFAULT 0,
    failure_count           INTEGER NOT NULL DEFAULT 0,
    total_prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens            INTEGER NOT NULL DEFAULT 0,
    total_cost              REAL    NOT NULL DEFAULT 0,
    total_saved_cache_cost  REAL    NOT NULL DEFAULT 0,
    total_duration_ms       INTEGER NOT NULL DEFAULT 0,
    latency_samples         TEXT    NOT NULL DEFAULT '[]',
    updated_at              INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS llm_daily_date_model_idx ON litellm_daily_agg(date, model);
  CREATE INDEX IF NOT EXISTS llm_daily_date_idx              ON litellm_daily_agg(date);
`;

/**
 * Get the analytics database singleton.
 * Creates tables on first connection.
 */
export function getAnalyticsDatabase(): Database.Database {
  if (_db) return _db;

  mkdirSync(getAnalyticsDir(), { recursive: true });

  _db = new Database(getAnalyticsDatabasePath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(SCHEMA_SQL);

  return _db;
}

/**
 * Close the analytics database connection.
 * Called during graceful shutdown.
 */
export function closeAnalyticsDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
