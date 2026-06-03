/**
 * Cross-dialect SQL helpers.
 *
 * Smooths over the handful of places where libsql and node-postgres differ in
 * result shape or in how timestamps are bound/compared. Consumers import these
 * instead of reaching for dialect-specific fields directly.
 */
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { isPostgres } from "./is-postgres";

/**
 * Normalize the affected-row count off a Drizzle mutation result.
 * libsql exposes `rowsAffected`; node-postgres exposes `rowCount`.
 */
export function affectedRows(result: {
  rowsAffected?: number | null;
  rowCount?: number | null;
}): number {
  return result.rowsAffected ?? result.rowCount ?? 0;
}

/**
 * `col < date` comparison that binds correctly per dialect.
 *
 * On Postgres the column is a `timestamptz`, so we bind the `Date` directly and
 * let the driver serialize it. On SQLite the column stores epoch milliseconds
 * as an integer, so we compare against `date.getTime()`.
 */
export function ltDate(col: SQL | AnyColumn, date: Date): SQL {
  return isPostgres() ? sql`${col} < ${date}` : sql`${col} < ${date.getTime()}`;
}

/**
 * `col > date` comparison that binds correctly per dialect. See `ltDate`.
 */
export function gtDate(col: SQL | AnyColumn, date: Date): SQL {
  return isPostgres() ? sql`${col} > ${date}` : sql`${col} > ${date.getTime()}`;
}

/**
 * Parse a raw timestamp value returned from a raw SQL query (e.g. a recursive
 * CTE) into a `Date`. The pg driver already returns `Date` objects for
 * timestamp columns; the libsql driver returns the stored epoch integer
 * (seconds or milliseconds depending on the column).
 */
export function parseRawTimestamp(value: unknown, unit: "s" | "ms"): Date {
  if (value instanceof Date) return value;
  const n = Number(value);
  return new Date(unit === "s" ? n * 1000 : n);
}
