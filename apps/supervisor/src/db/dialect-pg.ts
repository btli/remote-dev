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

export function buildPgDialect(): Dialect {
  // Lazy connect: constructing the Pool makes no connection.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // NodePgDatabase is CRUD-compatible with the libsql-typed AppDb. The cast
  // keeps the consumer-facing type stable across dialects.
  const db = drizzle(pool, { schema: pgSchema }) as unknown as AppDb;
  return { db };
}
