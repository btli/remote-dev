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
  /**
   * Canonical column-set signatures of every FULL (non-partial) UNIQUE
   * constraint on the table, INCLUDING the inline column-level `.unique()` ones
   * backed by `sqlite_autoindex_*` (and NAMED `CREATE UNIQUE INDEX`). Each entry
   * is `JSON.stringify(sortedColumnNames)`, so it is a stable, order-independent
   * identity for "these columns are unique together" — auto-index NAMES are not
   * stable identifiers, the column SET is.
   *
   * Deliberately EXCLUDED (each would risk a normalization-fragile false positive
   * on the deploy-critical path, and a missed rare drift there is the safer
   * trade):
   *  - PRIMARY KEY uniqueness (origin `pk`) — already covered by the per-column
   *    `pk` flag, so including it would double-report;
   *  - PARTIAL unique indexes (`CREATE UNIQUE INDEX … WHERE …`, `partial=1`) —
   *    partial uniqueness is not comparable by column-SET alone (its meaning
   *    depends on the WHERE predicate, which we intentionally don't normalize);
   *  - EXPRESSION unique indexes (a null column name from `pragma_index_info`).
   */
  uniqueSignatures: string[];
  /**
   * Ordered column lists for each NAMED (`CREATE INDEX` / `CREATE UNIQUE INDEX`,
   * i.e. non-`sqlite_autoindex_*`) index whose columns are ALL plain columns,
   * keyed by index name, in `pragma_index_info` `seqno` order. Lets the diff
   * catch a same-NAME index whose column set or ORDER changed (the name-only
   * check misses that). An index that contains ANY EXPRESSION column (null name
   * from `pragma_index_info`) is OMITTED entirely from this map — an expression
   * is not comparable by column-name (two same-name indexes over DIFFERENT
   * expressions would otherwise compare equal) — so its column-signature is left
   * unverified, consistent with not comparing collation / sort direction /
   * partial WHERE. Such an index is still tracked by NAME via `indexes`, so a
   * wholesale drop is still caught.
   */
  namedIndexColumns: Record<string, string[]>;
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
  /**
   * UNIQUE-constraint column signatures expected (in schema.ts) but absent live
   * — catches an inline `.unique()` added to a populated column whose table
   * rebuild `db:push` SKIPPED. Each entry is a `JSON.stringify(sortedColumns)`
   * signature (see `TableCols.uniqueSignatures`). Extra LIVE unique constraints
   * are NOT drift (db:push never drops), matching the one-way index/column
   * policy.
   */
  missingUniqueConstraints: string[];
  /**
   * NAMED indexes present in BOTH expected and live whose ordered column list
   * differs (set or order) — the same-name-different-columns drift the name-only
   * check misses. An index missing live entirely is reported via
   * `missingIndexes`, not here.
   */
  changedIndexes: Array<{
    index: string;
    expectedColumns: string[];
    liveColumns: string[];
  }>;
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
 * Canonical, order-independent signature for a UNIQUE constraint over a set of
 * column names: `JSON.stringify` of the names sorted ascending. Order-independent
 * because `UNIQUE(a, b)` and `UNIQUE(b, a)` enforce the same constraint; JSON so
 * the separator can never collide with a column identifier. Both the live read
 * and the expected read funnel through this, so the two sides are guaranteed to
 * use an identical format.
 */
export function uniqueColumnSignature(columns: string[]): string {
  return JSON.stringify(columns.slice().sort());
}

/**
 * Pure column- and index-level diff of an EXPECTED schema (from schema.ts)
 * against the LIVE schema. For every expected table, the following are recorded
 * as drift: a missing table, a missing/extra column, a column whose
 * type/notnull/pk differs, a named index present in expected but absent live, a
 * UNIQUE-constraint column signature present in expected but absent live
 * (catches inline `.unique()` that `db:push` skipped on a populated table), and
 * a same-NAME index whose ordered column list changed. Extra LIVE
 * tables/columns/indexes/unique-constraints (present live, absent in expected)
 * are intentionally ignored — db:push never DROPs, so leftover schema objects
 * are not a deploy-breaking drift and would only produce false alarms for
 * renamed/retired objects.
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
  const liveUniqueByTable = new Map<string, Set<string>>();
  const liveNamedIndexColsByTable = new Map<string, Record<string, string[]>>();
  for (const t of live) {
    liveByTable.set(t.table, new Map(t.columns.map((c) => [c.name, c])));
    liveIndexesByTable.set(t.table, new Set(t.indexes));
    liveUniqueByTable.set(t.table, new Set(t.uniqueSignatures));
    liveNamedIndexColsByTable.set(t.table, t.namedIndexColumns);
  }

  const tables: TableDrift[] = [];

  for (const exp of expected) {
    const liveCols = liveByTable.get(exp.table);
    if (!liveCols) {
      // Whole table is missing — we already report it in full; don't separately
      // enumerate the indexes/unique constraints it would have carried.
      tables.push({
        table: exp.table,
        missingTable: true,
        missingColumns: exp.columns.map((c) => c.name),
        extraColumns: [],
        changedColumns: [],
        missingIndexes: [],
        missingUniqueConstraints: [],
        changedIndexes: [],
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

    // UNIQUE constraints expected (by column SET signature) but absent live —
    // catches an inline `.unique()` whose table rebuild db:push skipped. Compared
    // by column SIGNATURE (not auto-index name, which is unstable). One-way:
    // extra live unique constraints are NOT drift.
    const liveUnique =
      liveUniqueByTable.get(exp.table) ?? new Set<string>();
    const missingUniqueConstraints = exp.uniqueSignatures.filter(
      (sig) => !liveUnique.has(sig),
    );

    // NAMED indexes present in BOTH sides whose ordered columns differ — the
    // same-name/different-columns drift the name check misses. An index absent
    // live is already covered by `missingIndexes`, so skip those here.
    const liveNamedIdxCols =
      liveNamedIndexColsByTable.get(exp.table) ?? {};
    const changedIndexes: TableDrift["changedIndexes"] = [];
    for (const [idxName, expCols] of Object.entries(exp.namedIndexColumns)) {
      const liveCols = liveNamedIdxCols[idxName];
      if (liveCols === undefined) continue; // missing → reported via missingIndexes
      if (
        liveCols.length !== expCols.length ||
        liveCols.some((c, i) => c !== expCols[i])
      ) {
        changedIndexes.push({
          index: idxName,
          expectedColumns: expCols,
          liveColumns: liveCols,
        });
      }
    }

    if (
      missingColumns.length > 0 ||
      extraColumns.length > 0 ||
      changedColumns.length > 0 ||
      missingIndexes.length > 0 ||
      missingUniqueConstraints.length > 0 ||
      changedIndexes.length > 0
    ) {
      tables.push({
        table: exp.table,
        missingTable: false,
        missingColumns,
        extraColumns,
        changedColumns,
        missingIndexes,
        missingUniqueConstraints,
        changedIndexes,
      });
    }
  }

  return { hasDrift: tables.length > 0, tables };
}

/**
 * Read the app tables + columns + indexes + unique signatures from a SQLite
 * file. Exported so the real-libsql read path (pragma_index_info parsing of
 * inline-unique / named / named-unique indexes) is smoke-tested against an
 * actual database, not just the pure `diffSchemas` contract.
 */
export function readSchema(dbFile: string, readonly: boolean): TableCols[] {
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
      // pragma_index_list → { seq, name, unique, origin, partial }.
      //   origin: 'c' = CREATE INDEX, 'u' = UNIQUE column/table constraint,
      //           'pk' = PRIMARY KEY. partial: 1 if the index has a WHERE clause.
      //   `unique` is a SQLite keyword → quote it.
      const idxRows = db
        .prepare(
          'SELECT name, "unique", origin, partial FROM pragma_index_list(?)',
        )
        .all(name) as Array<{
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }>;

      // Named (`CREATE INDEX`/`CREATE UNIQUE INDEX`) indexes — drop the
      // `sqlite_autoindex_*` ones SQLite auto-creates for inline UNIQUE/PK.
      const indexes = idxRows
        .map((r) => r.name)
        .filter((idxName) => !idxName.startsWith("sqlite_autoindex_"));

      // Resolve each index's COLUMNS via pragma_index_info (seqno order). An
      // expression column has a null name (cid < 0).
      const namedIndexColumns: Record<string, string[]> = {};
      const uniqueSignatures: string[] = [];
      for (const idx of idxRows) {
        // pragma_index_info → { seqno, cid, name }; bound param, no injection.
        const infoRows = db
          .prepare("SELECT seqno, cid, name FROM pragma_index_info(?)")
          .all(idx.name) as Array<{
          seqno: number;
          cid: number;
          name: string | null;
        }>;
        const ordered = infoRows
          .slice()
          .sort((a, b) => a.seqno - b.seqno)
          .map((r) => r.name);
        const hasExprColumn = ordered.some((c) => c === null);

        // NAMED-index column signature, BUT only when every column is a plain
        // column (no expression). An expression column (null name) is NOT
        // comparable by column-name alone — two same-name indexes over DIFFERENT
        // expressions would compare equal via a sentinel — so we skip the whole
        // index's column-signature comparison (consistent with not comparing
        // partial-WHERE / collation). Such an index is still tracked by NAME via
        // `indexes` (so a wholesale drop is still caught).
        if (!idx.name.startsWith("sqlite_autoindex_") && !hasExprColumn) {
          namedIndexColumns[idx.name] = ordered as string[];
        }

        // UNIQUE signatures (inline + named unique), EXCLUDING:
        //  - the PK (origin 'pk' — already covered by the per-column pk flag, so
        //    including it would double-report);
        //  - PARTIAL unique indexes (`CREATE UNIQUE INDEX … WHERE …`, partial=1)
        //    — partial uniqueness is NOT reliably comparable by column-SET alone
        //    (the WHERE predicate, which we deliberately don't normalize, changes
        //    its meaning), so a partial-unique change between the fresh-pushed
        //    EXPECTED temp DB and LIVE would otherwise false-positive-abort;
        //  - expression unique indexes (a null column name) — same un-normalizable
        //    reason.
        // A missed rare drift in these cases is preferable to wedging deploys.
        if (idx.unique === 1 && idx.origin !== "pk" && idx.partial !== 1) {
          if (!hasExprColumn) {
            uniqueSignatures.push(
              uniqueColumnSignature(ordered as string[]),
            );
          }
        }
      }

      result.push({
        table: name,
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull,
          pk: c.pk,
        })),
        indexes,
        uniqueSignatures,
        namedIndexColumns,
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
    if (t.missingUniqueConstraints.length > 0) {
      // Each signature is JSON of the sorted column names — render the columns.
      const sigs = t.missingUniqueConstraints
        .map((s) => `(${(JSON.parse(s) as string[]).join(", ")})`)
        .join(", ");
      parts.push(`missing UNIQUE constraints on: ${sigs}`);
    }
    for (const c of t.changedColumns) {
      parts.push(
        `column '${c.column}' changed ` +
          `(expected type=${c.expected.type || "''"} notnull=${c.expected.notnull} pk=${c.expected.pk}, ` +
          `live type=${c.live.type || "''"} notnull=${c.live.notnull} pk=${c.live.pk})`,
      );
    }
    for (const ci of t.changedIndexes) {
      parts.push(
        `index '${ci.index}' columns changed ` +
          `(expected [${ci.expectedColumns.join(", ")}], ` +
          `live [${ci.liveColumns.join(", ")}])`,
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
