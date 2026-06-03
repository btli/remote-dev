/**
 * Synchronous dialect facade for the Supervisor database.
 *
 * `import { db } from "@/db"` must keep working for every consumer, with the
 * active backend (SQLite vs PostgreSQL) chosen once at boot from `DATABASE_URL`.
 * This module defines the stable, consumer-facing Drizzle type and the single
 * switch point.
 *
 * There is NO top-level await: both builders are imported statically and
 * `getDialect()` invokes exactly one synchronously. The Postgres builder
 * constructs a lazy `pg.Pool` (no connection until first query), so importing
 * this module never blocks on I/O.
 */
import { isPostgres } from "./is-postgres";
import { buildSqliteDialect } from "./dialect-sqlite";
import { buildPgDialect } from "./dialect-pg";

/**
 * The stable, consumer-facing Drizzle database type, pinned to the libsql-typed
 * database over the SQLite schema. `$inferSelect` / `$inferInsert` are identical
 * across dialects by construction (see schema.ts), so this type describes both
 * backends for CRUD purposes. The Postgres builder casts its `NodePgDatabase`
 * to this type.
 */
export type AppDb = import("drizzle-orm/libsql").LibSQLDatabase<
  typeof import("./schema.sqlite")
>;

export interface Dialect {
  db: AppDb;
}

/**
 * Build the active dialect. Reads `DATABASE_URL` (via `isPostgres()`) and
 * constructs exactly one backend. Both builders are statically imported but
 * only the selected one runs, so the unused driver never connects.
 */
export function getDialect(): Dialect {
  return isPostgres() ? buildPgDialect() : buildSqliteDialect();
}
