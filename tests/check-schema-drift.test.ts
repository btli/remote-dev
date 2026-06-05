import { describe, it, expect } from "vitest";
import {
  diffSchemas,
  type ColumnInfo,
  type TableCols,
} from "../scripts/check-schema-drift";

/** Helper: build a column with sensible defaults. */
function col(name: string, type = "TEXT", notnull = 0, pk = 0): ColumnInfo {
  return { name, type, notnull, pk };
}

/**
 * Build the canonical signature for a UNIQUE constraint over `cols`, exactly as
 * `readSchema` does (`JSON.stringify` of the column NAMES sorted ascending).
 * Keeps fixtures in lock-step with the production canonicalization so a test
 * can never accidentally diverge from the real signature format.
 */
function uniqueSig(...cols: string[]): string {
  return JSON.stringify(cols.slice().sort());
}

/**
 * A representative two-table schema used as the "expected" side.
 *
 * `users.email` carries an INLINE `.unique()` (backed by a `sqlite_autoindex_*`
 * index, NOT a named `CREATE INDEX`), so it surfaces as a unique-column
 * signature rather than a named index. `notification_event` has one NAMED index
 * whose ordered columns are tracked for column-signature comparison.
 */
function expectedSchema(): TableCols[] {
  return [
    {
      table: "notification_event",
      columns: [
        col("id", "TEXT", 1, 1),
        col("severity", "TEXT", 1),
        col("coalesce_key", "TEXT", 0),
        col("count", "INTEGER", 1),
        col("meta", "TEXT", 0),
        col("updated_at", "INTEGER", 1),
      ],
      indexes: ["notification_event_coalesce_idx"],
      uniqueSignatures: [],
      namedIndexColumns: { notification_event_coalesce_idx: ["coalesce_key"] },
    },
    {
      table: "users",
      columns: [col("id", "TEXT", 1, 1), col("email", "TEXT", 0)],
      indexes: [],
      // Inline `.unique()` on email → a unique signature, no named index.
      uniqueSignatures: [uniqueSig("email")],
      namedIndexColumns: {},
    },
  ];
}

describe("diffSchemas", () => {
  it("reports NO drift when expected and live are identical", () => {
    const expected = expectedSchema();
    // Deep-clone so identity differences can't accidentally pass the test.
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
    expect(report.tables).toHaveLength(0);
  });

  it("detects a MISSING COLUMN (the notification_event regression)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live notification_event lost severity + updated_at (the real drift).
    live[0].columns = live[0].columns.filter(
      (c) => c.name !== "severity" && c.name !== "updated_at",
    );

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift).toBeDefined();
    expect(drift?.missingTable).toBe(false);
    expect(drift?.missingColumns.sort()).toEqual(["severity", "updated_at"]);
    expect(drift?.extraColumns).toEqual([]);
    expect(drift?.changedColumns).toEqual([]);
  });

  it("detects an EXTRA column present live but not in schema.ts", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    live[1].columns.push(col("legacy_flag", "INTEGER", 0));

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "users");
    expect(drift?.extraColumns).toEqual(["legacy_flag"]);
    expect(drift?.missingColumns).toEqual([]);
  });

  it("detects a NOTNULL change on an existing column", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live made users.email NOT NULL while schema.ts has it nullable.
    const email = live[1].columns.find((c) => c.name === "email")!;
    email.notnull = 1;

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "users");
    expect(drift?.changedColumns).toEqual([
      {
        column: "email",
        expected: { type: "TEXT", notnull: 0, pk: 0 },
        live: { type: "TEXT", notnull: 1, pk: 0 },
      },
    ]);
  });

  it("detects a TYPE change on an existing column", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    const count = live[0].columns.find((c) => c.name === "count")!;
    count.type = "TEXT"; // schema.ts wants INTEGER

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.changedColumns).toEqual([
      {
        column: "count",
        expected: { type: "INTEGER", notnull: 1, pk: 0 },
        live: { type: "TEXT", notnull: 1, pk: 0 },
      },
    ]);
  });

  it("detects a PRIMARY KEY change on an existing column", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live users.id lost its PRIMARY KEY membership (pk 1 → 0).
    const id = live[1].columns.find((c) => c.name === "id")!;
    id.pk = 0;

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "users");
    expect(drift?.changedColumns).toEqual([
      {
        column: "id",
        expected: { type: "TEXT", notnull: 1, pk: 1 },
        live: { type: "TEXT", notnull: 1, pk: 0 },
      },
    ]);
  });

  it("ignores a case-only TYPE difference (drizzle-kit casing must not abort the deploy)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live reports lowercased SQLite types (e.g. a future drizzle-kit casing
    // change) — same types, different case → NOT drift.
    for (const c of live[0].columns) c.type = c.type.toLowerCase();

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
    expect(report.tables).toHaveLength(0);
  });

  it("detects a MISSING TABLE (table in schema.ts absent from live)", () => {
    const expected = expectedSchema();
    // Live is missing the users table entirely.
    const live: TableCols[] = [
      JSON.parse(JSON.stringify(expected[0])) as TableCols,
    ];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "users");
    expect(drift?.missingTable).toBe(true);
    expect(drift?.missingColumns.sort()).toEqual(["email", "id"]);
  });

  it("ignores EXTRA live tables (db:push never drops; not deploy-breaking)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    live.push({
      table: "retired_table",
      columns: [col("x", "TEXT", 0)],
      indexes: [],
      uniqueSignatures: [],
      namedIndexColumns: {},
    });

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
  });

  it("detects a MISSING INDEX (the notification_event_coalesce_idx regression)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live notification_event lost the named coalesce index (the original
    // prod incident dropped this index alongside the columns).
    live[0].indexes = [];
    live[0].namedIndexColumns = {};

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift).toBeDefined();
    expect(drift?.missingTable).toBe(false);
    expect(drift?.missingIndexes).toEqual(["notification_event_coalesce_idx"]);
    expect(drift?.missingColumns).toEqual([]);
    expect(drift?.extraColumns).toEqual([]);
    expect(drift?.changedColumns).toEqual([]);
  });

  it("ignores an EXTRA live index not in schema.ts (db:push never drops)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live has a leftover/manual index schema.ts doesn't declare.
    live[1].indexes = ["users_legacy_idx"];
    live[1].namedIndexColumns = { users_legacy_idx: ["email"] };

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
  });

  it("reports NO drift when expected and live indexes match", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Index order differs but the set matches → still no drift.
    live[0].indexes = ["notification_event_coalesce_idx"];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
    expect(report.tables).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // remote-dev-8r0z: inline UNIQUE constraints (by column signature) + index
  // column-signature drift (not just name).
  // ──────────────────────────────────────────────────────────────────────────

  it("detects a MISSING inline UNIQUE constraint (added .unique() that db:push skipped)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // schema.ts added `.unique()` to users.email, but db:push SKIPPED the table
    // rebuild on the populated table → live has NO unique constraint.
    live[1].uniqueSignatures = [];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "users");
    expect(drift?.missingTable).toBe(false);
    expect(drift?.missingUniqueConstraints).toEqual([uniqueSig("email")]);
    // Pure-unique drift must not masquerade as a column/index change.
    expect(drift?.missingColumns).toEqual([]);
    expect(drift?.changedColumns).toEqual([]);
    expect(drift?.missingIndexes).toEqual([]);
    expect(drift?.changedIndexes).toEqual([]);
  });

  it("detects a MISSING composite UNIQUE constraint by column SET, order-independent", () => {
    const expected = expectedSchema();
    // Expected adds a composite unique over (severity, coalesce_key).
    expected[0].uniqueSignatures = [uniqueSig("severity", "coalesce_key")];
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live lacks it entirely.
    live[0].uniqueSignatures = [];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.missingUniqueConstraints).toEqual([
      uniqueSig("severity", "coalesce_key"),
    ]);
  });

  it("treats a unique constraint as MATCHING regardless of declared column ORDER", () => {
    const expected = expectedSchema();
    expected[0].uniqueSignatures = [uniqueSig("coalesce_key", "severity")];
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live reports the same two columns; signature is set-based (sorted), so the
    // order the columns were declared in must not matter.
    live[0].uniqueSignatures = [uniqueSig("severity", "coalesce_key")];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
    expect(report.tables).toHaveLength(0);
  });

  it("ignores an EXTRA live UNIQUE constraint not in schema.ts (db:push never drops)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live has a leftover unique constraint schema.ts no longer declares.
    live[0].uniqueSignatures = [uniqueSig("coalesce_key")];

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
  });

  it("detects an INDEX COLUMN-ORDER change on a same-NAME index", () => {
    const expected = expectedSchema();
    // Make the named index composite in a specific order.
    expected[0].namedIndexColumns = {
      notification_event_coalesce_idx: ["coalesce_key", "severity"],
    };
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Live has the SAME index name but the columns are in the OTHER order — a
    // real semantic difference (leftmost-prefix matching) the name check misses.
    live[0].namedIndexColumns = {
      notification_event_coalesce_idx: ["severity", "coalesce_key"],
    };

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.changedIndexes).toEqual([
      {
        index: "notification_event_coalesce_idx",
        expectedColumns: ["coalesce_key", "severity"],
        liveColumns: ["severity", "coalesce_key"],
      },
    ]);
    // Same name present both sides → not reported as a missing index.
    expect(drift?.missingIndexes).toEqual([]);
  });

  it("detects an INDEX COLUMN-SET change (different columns, same name)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Same index name, but live indexes a different column.
    live[0].namedIndexColumns = {
      notification_event_coalesce_idx: ["severity"],
    };

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.changedIndexes).toEqual([
      {
        index: "notification_event_coalesce_idx",
        expectedColumns: ["coalesce_key"],
        liveColumns: ["severity"],
      },
    ]);
  });

  it("reports NO index-column drift when a same-name index's columns match", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Identical columns in identical order → no drift.
    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift).toBeUndefined();
  });

  it("does NOT compare columns for an index missing live (missing-index path owns it)", () => {
    const expected = expectedSchema();
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    // Index absent live entirely: reported as missingIndexes, NOT changedIndexes
    // (no live columns to compare against).
    live[0].indexes = [];
    live[0].namedIndexColumns = {};

    const report = diffSchemas(expected, live);

    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.missingIndexes).toEqual(["notification_event_coalesce_idx"]);
    expect(drift?.changedIndexes).toEqual([]);
  });

  it("flags BOTH a missing unique constraint and a changed index on one table", () => {
    const expected = expectedSchema();
    expected[0].uniqueSignatures = [uniqueSig("coalesce_key")];
    expected[0].namedIndexColumns = {
      notification_event_coalesce_idx: ["coalesce_key", "count"],
    };
    const live: TableCols[] = JSON.parse(JSON.stringify(expected));
    live[0].uniqueSignatures = []; // unique dropped
    live[0].namedIndexColumns = {
      notification_event_coalesce_idx: ["coalesce_key"], // index narrowed
    };

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(true);
    const drift = report.tables.find((t) => t.table === "notification_event");
    expect(drift?.missingUniqueConstraints).toEqual([uniqueSig("coalesce_key")]);
    expect(drift?.changedIndexes).toEqual([
      {
        index: "notification_event_coalesce_idx",
        expectedColumns: ["coalesce_key", "count"],
        liveColumns: ["coalesce_key"],
      },
    ]);
  });
});
