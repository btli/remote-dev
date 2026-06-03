/**
 * PostgreSQL dialect builder (node-postgres) for the Supervisor database.
 *
 * Constructs a lazy `pg.Pool` — building the pool is synchronous and opens no
 * connection until the first query, so this is safe to call at import time with
 * no top-level await. Drizzle is wrapped over the Postgres schema and cast to
 * the consumer-facing `AppDb` type (CRUD is structurally compatible across
 * dialects; the inferred row types are identical by construction).
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as pgSchema from "./schema.pg";
import type { AppDb, Dialect } from "./dialect";
import { createLogger } from "@/lib/logger";

const log = createLogger("db/dialect-pg");

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
  return { db };
}
