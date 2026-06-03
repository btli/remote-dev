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
