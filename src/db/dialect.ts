/**
 * Synchronous dialect facade.
 *
 * `import { db, client } from "@/db"` must keep working for the 80+ consumers
 * that depend on it, with the active backend (SQLite vs PostgreSQL) chosen once
 * at boot from `DATABASE_URL`. This module is the single switch point.
 *
 * Crucially there is NO top-level await: both builders are imported statically
 * and `getDialect()` invokes exactly one of them synchronously. The Postgres
 * builder constructs a lazy `pg.Pool` (no connection is opened until first
 * query), so importing this module never blocks on I/O.
 */
import { isPostgres } from "./is-postgres";
import { buildSqliteDialect } from "./dialect-sqlite";
import { buildPgDialect } from "./dialect-pg";

/** Normalized result shape for raw SQL executed via the facade. */
export interface DialectExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

/**
 * Backend-agnostic raw-SQL escape hatch. `execute` takes libsql-style
 * positional `?` placeholders; the Postgres implementation rewrites them to
 * `$1..$N` internally so call sites stay dialect-neutral.
 */
export interface DialectClient {
  execute(sql: string, args?: unknown[]): Promise<DialectExecuteResult>;
  runProbe(): Promise<void>;
}

/**
 * The stable, consumer-facing Drizzle database type. It is intentionally pinned
 * to the libsql-typed database over the SQLite schema: `$inferSelect` /
 * `$inferInsert` are identical across dialects by construction (see
 * `schema.ts`), so this type describes both backends for CRUD purposes. The
 * Postgres builder casts its `NodePgDatabase` to this type.
 */
export type AppDb = import("drizzle-orm/libsql").LibSQLDatabase<
  typeof import("./schema.sqlite")
>;

export interface Dialect {
  db: AppDb;
  client: DialectClient;
  execute: DialectClient["execute"];
  runProbe: DialectClient["runProbe"];
}

/**
 * Build the active dialect. Reads `DATABASE_URL` (via `isPostgres()`) and
 * constructs exactly one backend. Both builders are statically imported but
 * only the selected one runs, so the unused driver never connects.
 */
export function getDialect(): Dialect {
  return isPostgres() ? buildPgDialect() : buildSqliteDialect();
}
