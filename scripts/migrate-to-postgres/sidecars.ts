#!/usr/bin/env bun
/**
 * Sidecar migration: copy the two better-sqlite3 sidecar databases (logs.db and
 * analytics.db) into the `logs` / `analytics` Postgres schemas.
 *
 * Unlike the main DB, the sidecars are NOT Drizzle — they are plain SQLite
 * databases written by better-sqlite3 in the running app. This migration CLI
 * runs under Bun, where the better-sqlite3 native addon is unsupported, so we
 * read the sidecar files with `@libsql/client` (a Bun-compatible SQLite driver
 * already in the dependency tree — it opens the same on-disk format). We write
 * with raw parameterized INSERTs through a node-postgres pool, after creating
 * the target schemas via `initSidecarSchemas()` (the SAME bootstrap the running
 * app uses, reused from src/infrastructure/persistence/pg/).
 *
 * COLUMN MAPPING (SQLite -> Postgres), per the sidecar schemas:
 *   logs.log_entry:    id INTEGER AUTOINCREMENT -> BIGSERIAL (id preserved on
 *                      insert; ON CONFLICT(id) DO NOTHING for idempotency)
 *   analytics.litellm_request_log:
 *                      cache_hit INTEGER 0/1     -> BOOLEAN
 *                      (all other columns map 1:1; TEXT/INTEGER/REAL)
 *   analytics.litellm_daily_agg:
 *                      date TEXT 'YYYY-MM-DD'    -> DATE   (pg casts the string)
 *                      latency_samples TEXT JSON -> JSONB  (pg casts the string)
 *
 * `initSidecarSchemas()` reads the pool from `getSidecarPool()`, which uses
 * `process.env.DATABASE_URL`; the CLI sets that to the `--to` URL before
 * importing, so the sidecar schemas land in the migration target DB.
 */

import { createClient, type Client } from "@libsql/client/node";
import type { Pool } from "pg";
import type { Logger } from "./logger";

/** Open a plain on-disk SQLite file for reading via libsql (Bun-compatible). */
function openSqlite(path: string): Client {
  return createClient({ url: `file:${path}` });
}

/** Read all rows of a query via libsql. */
async function readRows(
  client: Client,
  query: string
): Promise<Record<string, unknown>[]> {
  const r = await client.execute(query);
  return r.rows as unknown as Record<string, unknown>[];
}

export interface SidecarResult {
  readonly db: "logs" | "analytics";
  readonly table: string;
  readonly source: number;
  readonly inserted: number;
}

function existsCount(
  pool: Pool,
  schemaTable: string
): Promise<number> {
  return pool
    .query<{ n: string }>(`SELECT count(*)::bigint AS n FROM ${schemaTable}`)
    .then((r) => Number(r.rows[0]?.n ?? 0));
}

/** Copy logs.db -> logs.log_entry. */
export async function copyLogs(
  pool: Pool,
  sqlitePath: string,
  batchSize: number,
  log: Logger
): Promise<SidecarResult> {
  const sdb = openSqlite(sqlitePath);
  try {
    const rows = await readRows(
      sdb,
      `SELECT id, ts, level, namespace, message, data, source FROM log_entry ORDER BY id`
    );

    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values: unknown[] = [];
      const tuples: string[] = [];
      let p = 1;
      for (const r of batch) {
        tuples.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
        );
        values.push(
          r.id,
          r.ts,
          r.level,
          r.namespace,
          r.message,
          r.data ?? null,
          r.source ?? "nextjs"
        );
      }
      if (tuples.length === 0) continue;
      await pool.query(
        `INSERT INTO logs.log_entry (id, ts, level, namespace, message, data, source)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      inserted += batch.length;
    }
    log.info(`  logs.log_entry: ${rows.length} row(s)`);
    return { db: "logs", table: "log_entry", source: rows.length, inserted };
  } finally {
    sdb.close();
  }
}

/** Copy analytics.db -> analytics.litellm_request_log + analytics.litellm_daily_agg. */
export async function copyAnalytics(
  pool: Pool,
  sqlitePath: string,
  batchSize: number,
  log: Logger
): Promise<SidecarResult[]> {
  const sdb = openSqlite(sqlitePath);
  const results: SidecarResult[] = [];
  try {
    // --- litellm_request_log ---
    const reqCols = [
      "id",
      "model",
      "model_group",
      "api_base",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "response_cost",
      "saved_cache_cost",
      "start_time_ms",
      "end_time_ms",
      "duration_ms",
      "completion_start_ms",
      "status",
      "error_str",
      "session_id",
      "end_user",
      "api_key_hash",
      "api_key_alias",
      "requester_ip",
      "cache_hit",
      "raw_metadata",
      "requested_at",
    ];
    const reqRows = await readRows(
      sdb,
      `SELECT ${reqCols.join(", ")} FROM litellm_request_log`
    );

    let reqInserted = 0;
    for (let i = 0; i < reqRows.length; i += batchSize) {
      const batch = reqRows.slice(i, i + batchSize);
      const values: unknown[] = [];
      const tuples: string[] = [];
      let p = 1;
      for (const r of batch) {
        const ph = reqCols.map(() => `$${p++}`);
        tuples.push(`(${ph.join(", ")})`);
        for (const c of reqCols) {
          // cache_hit: SQLite 0/1 INTEGER -> Postgres BOOLEAN.
          if (c === "cache_hit") values.push(Boolean(r[c]));
          else values.push(r[c] ?? null);
        }
      }
      if (tuples.length === 0) continue;
      await pool.query(
        `INSERT INTO analytics.litellm_request_log (${reqCols.join(", ")})
         VALUES ${tuples.join(", ")}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      reqInserted += batch.length;
    }
    log.info(`  analytics.litellm_request_log: ${reqRows.length} row(s)`);
    results.push({
      db: "analytics",
      table: "litellm_request_log",
      source: reqRows.length,
      inserted: reqInserted,
    });

    // --- litellm_daily_agg ---
    const aggCols = [
      "id",
      "date",
      "model",
      "request_count",
      "success_count",
      "failure_count",
      "total_prompt_tokens",
      "total_completion_tokens",
      "total_tokens",
      "total_cost",
      "total_saved_cache_cost",
      "total_duration_ms",
      "latency_samples",
      "updated_at",
    ];
    const aggRows = await readRows(
      sdb,
      `SELECT ${aggCols.join(", ")} FROM litellm_daily_agg`
    );

    let aggInserted = 0;
    for (let i = 0; i < aggRows.length; i += batchSize) {
      const batch = aggRows.slice(i, i + batchSize);
      const values: unknown[] = [];
      const tuples: string[] = [];
      let p = 1;
      for (const r of batch) {
        // date TEXT -> DATE (pg casts); latency_samples TEXT(JSON) -> JSONB.
        const ph = aggCols.map((c) => {
          if (c === "date") return `$${p++}::date`;
          if (c === "latency_samples") return `$${p++}::jsonb`;
          return `$${p++}`;
        });
        tuples.push(`(${ph.join(", ")})`);
        for (const c of aggCols) {
          if (c === "latency_samples") values.push(r[c] ?? "[]");
          else values.push(r[c] ?? null);
        }
      }
      if (tuples.length === 0) continue;
      await pool.query(
        `INSERT INTO analytics.litellm_daily_agg (${aggCols.join(", ")})
         VALUES ${tuples.join(", ")}
         ON CONFLICT (date, model) DO NOTHING`,
        values
      );
      aggInserted += batch.length;
    }
    log.info(`  analytics.litellm_daily_agg: ${aggRows.length} row(s)`);
    results.push({
      db: "analytics",
      table: "litellm_daily_agg",
      source: aggRows.length,
      inserted: aggInserted,
    });

    return results;
  } finally {
    sdb.close();
  }
}

/** Verify sidecar counts match between SQLite source and Postgres target. */
export async function verifySidecars(
  pool: Pool,
  results: SidecarResult[],
  log: Logger
): Promise<boolean> {
  let ok = true;
  for (const r of results) {
    const schemaTable = `${r.db}.${r.table}`;
    const target = await existsCount(pool, schemaTable);
    const match = target === r.source;
    if (!match) ok = false;
    log.info(
      `  ${schemaTable.padEnd(36)} source=${r.source} target=${target} ${
        match ? "ok" : "MISMATCH"
      }`
    );
  }
  return ok;
}
