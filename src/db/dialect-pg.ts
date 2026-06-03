/**
 * PostgreSQL dialect builder (node-postgres).
 *
 * Constructs a lazy `pg.Pool` — building the pool is synchronous and opens no
 * connection until the first query, so this is safe to call at import time with
 * no top-level await. Drizzle is wrapped over the Postgres schema and cast to
 * the consumer-facing `AppDb` type (the only libsql-only method, `db.run`, has
 * been removed from all call sites; CRUD is structurally compatible).
 *
 * The `DialectClient.execute` facade accepts libsql-style positional `?`
 * placeholders and rewrites them to Postgres `$1..$N` so raw-SQL call sites
 * remain dialect-neutral.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as pgSchema from "./schema.pg";
import type { AppDb, Dialect, DialectExecuteResult } from "./dialect";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/dialect-pg");

/**
 * Convert libsql-style `?` placeholders to Postgres `$1..$N`, left to right.
 * The raw-SQL call sites in this codebase use `?` exclusively for bound values
 * (the recursive CTEs contain no literal `?` characters), so a positional
 * left-to-right substitution is correct.
 */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function buildPgDialect(): Dialect {
  // Lazy connect: constructing the Pool makes no connection.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // An idle client that errors (e.g. the backend terminates the connection)
  // emits 'error' on the Pool; without a listener Node treats it as unhandled
  // and crashes the process. Log and let the pool reap/replace the client.
  pool.on("error", (err) => log.error("idle pg client error", { error: String(err) }));

  // NodePgDatabase is CRUD-compatible with the libsql-typed AppDb. The cast
  // keeps the consumer-facing type stable across dialects.
  const db = drizzle(pool, { schema: pgSchema }) as unknown as AppDb;

  async function execute(
    sql: string,
    args: unknown[] = []
  ): Promise<DialectExecuteResult> {
    const pgText = toPgPlaceholders(sql);
    const r = await pool.query(pgText, args);
    return {
      rows: r.rows as Record<string, unknown>[],
      rowsAffected: r.rowCount ?? 0,
    };
  }

  async function runProbe(): Promise<void> {
    await pool.query("SELECT 1");
  }

  const client = { execute, runProbe };
  return { db, client, execute, runProbe };
}
