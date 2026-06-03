#!/usr/bin/env bun
/**
 * Copy engine: moves rows from a SQLite database into a Postgres database,
 * table by table, in FK-dependency order.
 *
 * THE DRIZZLE ROUND-TRIP (why this tool is nearly transform-free):
 * We read each table through a Drizzle libsql instance bound to the CONCRETE
 * SQLite schema, and write through a Drizzle node-postgres instance bound to
 * the CONCRETE Postgres schema. Drizzle's column "modes" do the storage<->JS
 * conversion on BOTH ends:
 *
 *   sqlite integer{mode:"boolean"}      -> JS boolean  -> pg boolean
 *   sqlite integer{mode:"timestamp_ms"} -> JS Date     -> pg timestamptz
 *   sqlite integer{mode:"timestamp"}    -> JS Date     -> pg timestamptz   (*)
 *   sqlite text{mode:"json"}            -> JS object   -> pg jsonb
 *   sqlite text / integer / real        -> JS string/number -> pg text/int/real
 *
 *   (*) mode:"timestamp" stores epoch SECONDS and mode:"timestamp_ms" stores
 *       epoch MILLISECONDS. Drizzle handles BOTH internally when materializing
 *       the JS `Date`, so the SECONDS-vs-MS inconsistency never surfaces here —
 *       we never touch raw epoch math. The same JS `Date` serializes to the pg
 *       `timestamp with time zone` column losslessly. This is the highest-risk
 *       column class and it is handled entirely by the round-trip.
 *
 * Because the $inferSelect/$inferInsert types are identical per table across
 * the two concrete schemas (proven by the codegen), a row object read from the
 * SQLite table is DIRECTLY insertable into the matching Postgres table.
 *
 * IDEMPOTENCY: inserts use `onConflictDoNothing()` (no target) so a re-run does
 * not raise duplicate-key errors and does not double-insert. With `--truncate`
 * the target is emptied first (TRUNCATE ... CASCADE) for a clean reload.
 *
 * SELF-REFERENTIAL TABLES: rows are copied in "waves" — roots (self-FK NULL)
 * first, then rows whose parent already landed — so a child never inserts
 * before its parent (avoids an FK violation on the self-reference).
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as pgSchema from "../../src/db/schema.pg";
import { PgTable } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import type { TableInfo } from "./schema-graph";
import type { Logger } from "./logger";

export interface CopyOptions {
  readonly batchSize: number;
  readonly truncate: boolean;
  readonly dryRun: boolean;
}

export interface TableResult {
  readonly sqlName: string;
  readonly sourceRows: number;
  readonly inserted: number;
  readonly skipped: boolean; // skipped via --resume watermark
}

/** Resolve the concrete Postgres table object by export key. */
export function pgTableFor(exportKey: string): PgTable {
  const value = (pgSchema as Record<string, unknown>)[exportKey];
  if (!(value instanceof PgTable)) {
    throw new Error(
      `No Postgres table found for export key "${exportKey}" in schema.pg`
    );
  }
  return value;
}

/** Read every row from a SQLite table via the Drizzle libsql instance. */
async function readAllRows(
  sqliteDb: LibSQLDatabase<typeof import("../../src/db/schema.sqlite")>,
  info: TableInfo
): Promise<Record<string, unknown>[]> {
  // `select()` materializes JS values through the SQLite column modes.
  const rows = await sqliteDb.select().from(info.sqliteTable as never);
  return rows as Record<string, unknown>[];
}

/** Chunk an array into fixed-size batches. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Order rows of a self-referential table parent-before-child. Rows whose
 * self-FK is NULL come first; subsequent waves contain rows whose parent id
 * is already present in an earlier wave. Any rows referencing a parent not in
 * this dataset (dangling) are emitted last so they still get copied (the FK is
 * `set null` in the schema, but we preserve the stored value and rely on the
 * referenced parent existing — or, if truly dangling, the insert orders after
 * all resolvable rows).
 */
function orderSelfReferential(
  rows: Record<string, unknown>[],
  pkCol: string,
  selfFkCol: string
): Record<string, unknown>[] {
  const ordered: Record<string, unknown>[] = [];
  const present = new Set<unknown>();
  let remaining = rows.slice();

  // Wave 0: roots (self-FK null).
  while (remaining.length > 0) {
    const wave = remaining.filter((r) => {
      const parent = r[selfFkCol];
      return parent == null || present.has(parent);
    });
    if (wave.length === 0) break; // only dangling refs remain
    for (const r of wave) {
      ordered.push(r);
      present.add(r[pkCol]);
    }
    const waveSet = new Set(wave);
    remaining = remaining.filter((r) => !waveSet.has(r));
  }

  // Append any dangling rows (parent not resolvable within this dataset).
  ordered.push(...remaining);
  return ordered;
}

/**
 * Copy a single table from SQLite to Postgres. Returns row counts. Honors
 * `--truncate` (CASCADE empty first) and always uses `onConflictDoNothing`
 * for idempotency on re-runs.
 */
export async function copyTable(
  sqliteDb: LibSQLDatabase<typeof import("../../src/db/schema.sqlite")>,
  pgDb: NodePgDatabase<typeof pgSchema>,
  info: TableInfo,
  opts: CopyOptions,
  log: Logger
): Promise<TableResult> {
  const pgTable = pgTableFor(info.exportKey);
  const pgName = getTableName(pgTable);

  let rows = await readAllRows(sqliteDb, info);
  const sourceRows = rows.length;

  if (opts.dryRun) {
    log.info(`  [dry-run] ${info.sqlName}: would copy ${sourceRows} row(s)`);
    return { sqlName: info.sqlName, sourceRows, inserted: 0, skipped: false };
  }

  if (opts.truncate) {
    // CASCADE so dependents (already truncated in this run or not) don't block.
    await pgDb.execute(
      sql.raw(`TRUNCATE TABLE "${pgName}" RESTART IDENTITY CASCADE`)
    );
    log.debug(`  truncated ${pgName} (CASCADE)`);
  }

  if (sourceRows === 0) {
    log.info(`  ${info.sqlName}: 0 rows`);
    return { sqlName: info.sqlName, sourceRows, inserted: 0, skipped: false };
  }

  // Row-level ordering for self-referential tables.
  if (info.selfReferential && info.selfFkColumn && info.primaryKey.length === 1) {
    rows = orderSelfReferential(
      rows,
      info.primaryKey[0],
      info.selfFkColumn
    );
  }

  let inserted = 0;
  for (const batch of chunk(rows, opts.batchSize)) {
    // onConflictDoNothing() with no target → ignore PK/unique conflicts. Safe
    // for re-runs (idempotent) and after a TRUNCATE (no conflicts to ignore).
    // Use the result's rowCount (rows ACTUALLY inserted) rather than the batch
    // length so the summary is accurate under ON CONFLICT DO NOTHING (a re-run
    // over already-present rows inserts 0). rowCount can be null in pg's typing;
    // fall back to the batch length only then.
    const result = await pgDb
      .insert(pgTable)
      .values(batch as never)
      .onConflictDoNothing();
    const affected = result.rowCount ?? batch.length;
    inserted += affected;
    log.debug(`    ${info.sqlName}: +${affected} (${inserted}/${sourceRows})`);
  }

  log.info(`  ${info.sqlName}: ${sourceRows} row(s) → ${pgName}`);
  return { sqlName: info.sqlName, sourceRows, inserted, skipped: false };
}
