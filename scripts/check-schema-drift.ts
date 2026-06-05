#!/usr/bin/env bun
/**
 * CLI entry: detect SQLite SCHEMA DRIFT between schema.ts and the live DB
 * (remote-dev-9qni).
 *
 * Invoked by `scripts/deploy.ts` immediately AFTER `bun run db:push`, mirroring
 * the existing `db:verify-backfills` abort-on-fail guard. Exits NON-ZERO if the
 * live SQLite schema does not match what schema.ts expects, so the deploy aborts
 * loudly instead of going green with a silently-drifted schema.
 *
 * WHY THIS EXISTS
 * ---------------
 * `db:push` is `drizzle-kit push`, which runs non-interactively in the deploy.
 * When a schema change is DATA-LOSS (e.g. adding a NOT NULL column with only an
 * app-level default to a table that already has rows), drizzle-kit SKIPS that
 * statement and exits 0 — leaving the live schema silently drifted from
 * schema.ts. This already broke prod once: `notification_event` lost
 * severity/coalesce_key/count/meta/updated_at → notifications/push died, yet the
 * deploy went green. This guard turns that silent drift into a LOUD failure. It
 * does NOT change the push strategy.
 *
 * HOW IT WORKS
 * ------------
 *  1. Skip on Postgres (the PG schema is applied via the drizzle/pg
 *     migrate-on-boot path, not db:push) — same gate as deploy.ts's db:push.
 *  2. Build the EXPECTED schema by running `drizzle-kit push` into a fresh, EMPTY
 *     temp RDV_DATA_DIR. An empty DB has no rows, so push applies the FULL
 *     schema.ts with no data-loss prompts/skips — that temp DB is the ground
 *     truth for "what schema.ts wants".
 *  3. Column-diff every expected table against the LIVE DB (opened readonly).
 *     Any missing table, missing/extra column, or changed type/notnull → drift.
 *  4. Any drift → print a namespaced report and exit 1. Else exit 0.
 *
 * Runs from the deploy-src worktree (origin/master code) but inspects the SAME
 * live DB the server serves, because the DB target resolves purely from env
 * (DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db), not cwd.
 *
 * Run manually with: bun run db:check-drift
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { getDatabasePath } from "../src/lib/paths";
import { shouldRunSqlitePush } from "./deploy-lib";

/** A single column's drift-relevant shape, sourced from `PRAGMA table_info`. */
export interface ColumnInfo {
  name: string;
  /** SQLite declared type, e.g. "TEXT", "INTEGER" (may be "" for typeless). */
  type: string;
  /** 1 if NOT NULL, 0 otherwise (PRAGMA's `notnull` flag). */
  notnull: number;
  /**
   * Position in the PRIMARY KEY (PRAGMA's `pk` flag): 0 = not part of the PK,
   * >0 = its 1-based ordinal within the PK. A change in this flag (e.g. a column
   * gaining/losing PK membership) is treated as column drift.
   */
  pk: number;
}

/** A table and the columns it declares. */
export interface TableCols {
  table: string;
  columns: ColumnInfo[];
  /**
   * Names of the table's EXPLICIT indexes (those created via `CREATE INDEX`).
   * Auto-created indexes backing UNIQUE/PK column constraints
   * (`sqlite_autoindex_*`) are excluded — they track their column and would
   * match whenever the column does, so only named `CREATE INDEX` indexes are
   * verified here.
   */
  indexes: string[];
}

/** One table's worth of differences between expected and live. */
export interface TableDrift {
  table: string;
  /** Table exists in expected schema.ts but is absent in the live DB. */
  missingTable: boolean;
  /** Columns expected but absent in the live DB. */
  missingColumns: string[];
  /** Columns present live but not in expected schema.ts. */
  extraColumns: string[];
  /** Columns present in both but whose type/notnull/pk differs. */
  changedColumns: Array<{
    column: string;
    expected: { type: string; notnull: number; pk: number };
    live: { type: string; notnull: number; pk: number };
  }>;
  /** Named indexes expected (in schema.ts) but absent in the live DB. */
  missingIndexes: string[];
}

export interface DriftReport {
  hasDrift: boolean;
  tables: TableDrift[];
}

/** Tables that are noise — not part of the app schema. */
function isIgnoredTable(name: string): boolean {
  return name.startsWith("sqlite_") || name === "__drizzle_migrations";
}

/**
 * Pure column- and index-level diff of an EXPECTED schema (from schema.ts)
 * against the LIVE schema. For every expected table: a missing table, a
 * missing/extra column, a column whose type or notnull flag differs, or a named
 * index present in expected but absent live is recorded as drift. Extra LIVE
 * tables/columns/indexes (present live, absent in expected) are intentionally
 * ignored — db:push never DROPs, so leftover schema objects are not a
 * deploy-breaking drift and would only produce false alarms for renamed/retired
 * objects.
 *
 * Exported and dependency-free so the diff contract is unit-tested without
 * spawning drizzle-kit or opening any real database.
 */
export function diffSchemas(
  expected: TableCols[],
  live: TableCols[],
): DriftReport {
  const liveByTable = new Map<string, Map<string, ColumnInfo>>();
  const liveIndexesByTable = new Map<string, Set<string>>();
  for (const t of live) {
    liveByTable.set(t.table, new Map(t.columns.map((c) => [c.name, c])));
    liveIndexesByTable.set(t.table, new Set(t.indexes));
  }

  const tables: TableDrift[] = [];

  for (const exp of expected) {
    const liveCols = liveByTable.get(exp.table);
    if (!liveCols) {
      // Whole table is missing — we already report it in full; don't separately
      // enumerate the indexes it would have carried.
      tables.push({
        table: exp.table,
        missingTable: true,
        missingColumns: exp.columns.map((c) => c.name),
        extraColumns: [],
        changedColumns: [],
        missingIndexes: [],
      });
      continue;
    }

    const expByName = new Map(exp.columns.map((c) => [c.name, c]));
    const missingColumns: string[] = [];
    const changedColumns: TableDrift["changedColumns"] = [];

    for (const ec of exp.columns) {
      const lc = liveCols.get(ec.name);
      if (!lc) {
        missingColumns.push(ec.name);
        continue;
      }
      // Compare type case-INSENSITIVELY: a future drizzle-kit SQLite type-casing
      // change (e.g. "INTEGER" → "integer") would otherwise make the freshly
      // built expected DB differ from the live DB and abort EVERY deploy.
      if (
        lc.type.toUpperCase() !== ec.type.toUpperCase() ||
        lc.notnull !== ec.notnull ||
        lc.pk !== ec.pk
      ) {
        changedColumns.push({
          column: ec.name,
          expected: { type: ec.type, notnull: ec.notnull, pk: ec.pk },
          live: { type: lc.type, notnull: lc.notnull, pk: lc.pk },
        });
      }
    }

    const extraColumns: string[] = [];
    for (const lc of liveCols.values()) {
      if (!expByName.has(lc.name)) extraColumns.push(lc.name);
    }

    // Named indexes expected but absent live. Extra live indexes are NOT drift
    // (db:push never drops), so we only check the expected → live direction.
    const liveIndexes = liveIndexesByTable.get(exp.table) ?? new Set<string>();
    const missingIndexes = exp.indexes.filter((idx) => !liveIndexes.has(idx));

    if (
      missingColumns.length > 0 ||
      extraColumns.length > 0 ||
      changedColumns.length > 0 ||
      missingIndexes.length > 0
    ) {
      tables.push({
        table: exp.table,
        missingTable: false,
        missingColumns,
        extraColumns,
        changedColumns,
        missingIndexes,
      });
    }
  }

  return { hasDrift: tables.length > 0, tables };
}

/** Read the app tables + columns from a SQLite file (readonly). */
function readSchema(dbFile: string, readonly: boolean): TableCols[] {
  const db = new Database(dbFile, { readonly });
  try {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    const result: TableCols[] = [];
    for (const { name } of tableRows) {
      if (isIgnoredTable(name)) continue;
      // Use the table-valued `pragma_*(?)` forms with a BOUND parameter rather
      // than interpolating the table name into the SQL — no injection surface.
      // (Verified working under the libsql driver; `notnull` is a SQLite keyword
      // so it must be quoted in the projection.)
      // pragma_table_info → { cid, name, type, notnull, dflt_value, pk }.
      const cols = db
        .prepare('SELECT name, type, "notnull", pk FROM pragma_table_info(?)')
        .all(name) as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      // pragma_index_list → { seq, name, unique, origin, partial }. Keep only
      // explicit `CREATE INDEX` indexes; drop `sqlite_autoindex_*` (the ones
      // SQLite auto-creates for UNIQUE/PK column constraints), which track their
      // column and would match whenever the column exists.
      const idxRows = db
        .prepare("SELECT name FROM pragma_index_list(?)")
        .all(name) as Array<{ name: string }>;
      const indexes = idxRows
        .map((r) => r.name)
        .filter((idxName) => !idxName.startsWith("sqlite_autoindex_"));
      result.push({
        table: name,
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull,
          pk: c.pk,
        })),
        indexes,
      });
    }
    return result;
  } finally {
    db.close();
  }
}

/** Build the EXPECTED schema DB by pushing schema.ts into an empty temp dir. */
function buildExpectedSchema(tmpDir: string): string {
  // Empty DB ⇒ no rows ⇒ no data-loss prompts ⇒ db:push applies ALL of
  // schema.ts. cwd is process.cwd() (deploy runs this from DEPLOY_SRC), so
  // drizzle.config.ts resolves schema.ts relative to the built tree.
  const result = spawnSync(
    "bun",
    ["--env-file=/dev/null", "x", "drizzle-kit", "push", "--config=drizzle.config.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, RDV_DATA_DIR: tmpDir, DATABASE_URL: "" },
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    console.error(
      "[schema-drift] FAILED to build expected schema (drizzle-kit push into temp dir).",
    );
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    // Can't verify → fail closed.
    process.exit(1);
  }

  const expectedDb = join(tmpDir, "sqlite.db");
  if (!existsSync(expectedDb)) {
    console.error(
      `[schema-drift] FAILED: expected schema DB was not created at ${expectedDb}`,
    );
    process.exit(1);
  }
  return expectedDb;
}

/** Print a human-readable, namespaced drift report (one block per table). */
function printReport(report: DriftReport): void {
  console.error(
    "[schema-drift] SCHEMA DRIFT DETECTED — the live SQLite schema does not " +
      "match schema.ts (db:push likely SKIPPED a data-loss change):",
  );
  for (const t of report.tables) {
    if (t.missingTable) {
      console.error(`[schema-drift]   table '${t.table}': MISSING from live DB`);
      continue;
    }
    const parts: string[] = [];
    if (t.missingColumns.length > 0) {
      parts.push(`missing columns: ${t.missingColumns.join(", ")}`);
    }
    if (t.extraColumns.length > 0) {
      parts.push(`unexpected columns: ${t.extraColumns.join(", ")}`);
    }
    if (t.missingIndexes.length > 0) {
      parts.push(`missing indexes: ${t.missingIndexes.join(", ")}`);
    }
    for (const c of t.changedColumns) {
      parts.push(
        `column '${c.column}' changed ` +
          `(expected type=${c.expected.type || "''"} notnull=${c.expected.notnull} pk=${c.expected.pk}, ` +
          `live type=${c.live.type || "''"} notnull=${c.live.notnull} pk=${c.live.pk})`,
      );
    }
    console.error(`[schema-drift]   table '${t.table}': ${parts.join("; ")}`);
  }
}

function main(): void {
  // 1. Postgres uses migrate-on-boot, not db:push — nothing for this guard to do.
  //    Reuse the exact predicate deploy.ts gates db:push behind.
  if (!shouldRunSqlitePush(process.env.DATABASE_URL)) {
    console.log(
      "[schema-drift] DATABASE_URL is Postgres — drift guard is SQLite-only " +
        "(PG schema is applied via migrate-on-boot); skipping.",
    );
    process.exit(0);
  }

  const liveDb = getDatabasePath();
  if (!existsSync(liveDb)) {
    // No live DB yet (fresh install): db:push just created it from schema.ts, so
    // there is nothing to drift from. Treat as in-sync.
    console.log(
      `[schema-drift] live DB not found at ${liveDb} (fresh install); nothing to verify.`,
    );
    process.exit(0);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "rdv-schema-expected-"));
  try {
    const expectedDb = buildExpectedSchema(tmpDir);
    const expected = readSchema(expectedDb, true);
    if (expected.length === 0) {
      console.error(
        "[schema-drift] FAILED: expected schema has 0 tables — refusing to verify.",
      );
      process.exit(1);
    }

    const live = readSchema(liveDb, /* readonly */ true);
    const report = diffSchemas(expected, live);

    if (report.hasDrift) {
      printReport(report);
      process.exit(1);
    }

    console.log(
      `[schema-drift] schema in sync (${expected.length} tables verified).`,
    );
    process.exit(0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Only run the CLI when executed directly (bun run scripts/check-schema-drift.ts),
// NOT when imported — tests import `diffSchemas` and must not trigger the live
// drift check or its process.exit. `import.meta.main` is true only for the entry
// module under both bun (the deploy runtime) and Node 24+ (the vitest runtime).
if (import.meta.main) {
  main();
}
