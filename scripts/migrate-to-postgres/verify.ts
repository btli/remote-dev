#!/usr/bin/env bun
/**
 * Post-copy verification: compare per-table row counts on the SQLite source
 * and the Postgres target. Prints a table of (source, target, diff) and
 * returns whether every selected table matched.
 *
 * Counts are read with raw `SELECT count(*)` against each side so the check is
 * independent of the copy path (it does not trust the engine's own tallies).
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import * as pgSchema from "../../src/db/schema.pg";
import type { TableInfo } from "./schema-graph";
import { pgTableFor } from "./copy-engine";
import type { Logger } from "./logger";

export interface VerifyRow {
  readonly sqlName: string;
  readonly source: number;
  readonly target: number;
  readonly match: boolean;
}

async function countSqlite(
  sqliteDb: LibSQLDatabase<typeof import("../../src/db/schema.sqlite")>,
  info: TableInfo
): Promise<number> {
  const r = (await sqliteDb
    .select({ n: sql<number>`count(*)` })
    .from(info.sqliteTable as never)) as { n: number }[];
  return Number(r[0]?.n ?? 0);
}

async function countPg(
  pgDb: NodePgDatabase<typeof pgSchema>,
  info: TableInfo
): Promise<number> {
  const pgTable = pgTableFor(info.exportKey);
  const name = getTableName(pgTable);
  // node-postgres execute() returns a QueryResult whose `.rows` holds the data.
  const result = await pgDb.execute(
    sql.raw(`SELECT count(*)::bigint AS n FROM "${name}"`)
  );
  const rows = (result as unknown as { rows: { n: string | number }[] }).rows;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Verify counts for the given tables. Returns `{ ok, rows }`; `ok` is false if
 * ANY selected table's counts differ.
 */
export async function verifyCounts(
  sqliteDb: LibSQLDatabase<typeof import("../../src/db/schema.sqlite")>,
  pgDb: NodePgDatabase<typeof pgSchema>,
  tables: TableInfo[],
  log: Logger
): Promise<{ ok: boolean; rows: VerifyRow[] }> {
  const rows: VerifyRow[] = [];
  for (const info of tables) {
    const source = await countSqlite(sqliteDb, info);
    const target = await countPg(pgDb, info);
    rows.push({ sqlName: info.sqlName, source, target, match: source === target });
  }

  const ok = rows.every((r) => r.match);

  // Pretty table.
  const nameW = Math.max(10, ...rows.map((r) => r.sqlName.length));
  log.info("");
  log.info("Verification (row counts):");
  log.info(
    `  ${"table".padEnd(nameW)}  ${"source".padStart(8)}  ${"target".padStart(8)}  status`
  );
  for (const r of rows) {
    const status = r.match ? "ok" : "MISMATCH";
    log.info(
      `  ${r.sqlName.padEnd(nameW)}  ${String(r.source).padStart(8)}  ${String(
        r.target
      ).padStart(8)}  ${status}`
    );
  }
  const mismatches = rows.filter((r) => !r.match);
  if (mismatches.length > 0) {
    log.error(
      `\n  ${mismatches.length} table(s) mismatched: ${mismatches
        .map((m) => `${m.sqlName}(${m.source}->${m.target})`)
        .join(", ")}`
    );
  } else {
    log.info(`\n  All ${rows.length} table(s) match.`);
  }

  return { ok, rows };
}
