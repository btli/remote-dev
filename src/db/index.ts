/**
 * Database entry point.
 *
 * Resolves the active dialect (SQLite or PostgreSQL, chosen at boot by
 * `DATABASE_URL`) synchronously and re-exports its handles. Consumers continue
 * to `import { db, client } from "@/db"` unchanged; `execute` / `runProbe` are
 * the dialect-neutral raw-SQL escape hatches.
 */
import { getDialect } from "./dialect";

const _d = getDialect();

export const db = _d.db;
export const client = _d.client; // DialectClient facade (NOT the raw libsql client)
export const execute = _d.execute; // execute(sql, args)
export const runProbe = _d.runProbe;

/**
 * Flush + TRUNCATE the SQLite WAL. Present only on the SQLite dialect (Postgres
 * has no WAL of its own to manage here) — `undefined` on Postgres, so callers
 * must guard. The terminal server invokes this on a timer to keep the WAL from
 * growing unbounded (see src/server/wal-checkpoint.ts).
 */
export const checkpointWal = _d.checkpointWal;
