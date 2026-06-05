import { describe, it, expect } from "vitest";
import {
  diffSchemas,
  type ColumnInfo,
  type TableCols,
} from "../scripts/check-schema-drift";

/** Helper: build a column with sensible defaults. */
function col(
  name: string,
  type = "TEXT",
  notnull = 0,
): ColumnInfo {
  return { name, type, notnull };
}

/** A representative two-table schema used as the "expected" side. */
function expectedSchema(): TableCols[] {
  return [
    {
      table: "notification_event",
      columns: [
        col("id", "TEXT", 1),
        col("severity", "TEXT", 1),
        col("coalesce_key", "TEXT", 0),
        col("count", "INTEGER", 1),
        col("meta", "TEXT", 0),
        col("updated_at", "INTEGER", 1),
      ],
    },
    {
      table: "users",
      columns: [col("id", "TEXT", 1), col("email", "TEXT", 0)],
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
        expected: { type: "TEXT", notnull: 0 },
        live: { type: "TEXT", notnull: 1 },
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
        expected: { type: "INTEGER", notnull: 1 },
        live: { type: "TEXT", notnull: 1 },
      },
    ]);
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
    live.push({ table: "retired_table", columns: [col("x", "TEXT", 0)] });

    const report = diffSchemas(expected, live);

    expect(report.hasDrift).toBe(false);
  });
});
