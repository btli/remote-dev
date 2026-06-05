/**
 * Real-libsql smoke for the schema-drift guard (remote-dev-8r0z).
 *
 * The pure `diffSchemas` contract is covered in `check-schema-drift.test.ts`
 * with hand-built fixtures. THIS file instead drives the actual `readSchema`
 * read path against REAL on-disk libsql databases, so it proves that
 * `pragma_index_info`/`pragma_index_list` are parsed correctly for the shapes
 * that matter: an inline column `.unique()` (a `sqlite_autoindex_*`), a plain
 * named `CREATE INDEX`, a named `CREATE UNIQUE INDEX`, a composite index whose
 * column ORDER matters, a DESC index (sort direction must be ignored), and the
 * PRIMARY KEY (must NOT leak into the unique signatures — it is covered by the
 * column `pk` flag). Without this, a libsql pragma-shape change could silently
 * break the guard while the fixture-only tests stayed green.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import {
  readSchema,
  diffSchemas,
  uniqueColumnSignature,
  type TableCols,
} from "../scripts/check-schema-drift";

let dir: string;

/** Create a libsql DB file at `path` and run `ddl` against it. */
function makeDb(path: string, ddl: string): void {
  const db = new Database(path);
  try {
    db.exec(ddl);
  } finally {
    db.close();
  }
}

/** The canonical schema both the expected and the matching-live DB use. */
const BASE_DDL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE,
    org_id TEXT,
    name TEXT
  );
  -- plain named index
  CREATE INDEX users_name_idx ON users (name);
  -- named UNIQUE index over a column SET
  CREATE UNIQUE INDEX users_org_email_uq ON users (org_id, email);
  -- composite ordered index (order is semantically load-bearing)
  CREATE INDEX users_org_name_idx ON users (org_id, name);
  -- descending index: pragma_index_info reports the column WITHOUT direction
  CREATE INDEX users_name_desc_idx ON users (name DESC);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rdv-drift-smoke-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readSchema (real libsql) — index/unique signature extraction", () => {
  it("reads the inline .unique(), named indexes, and unique columns correctly", () => {
    const p = join(dir, "base.db");
    makeDb(p, BASE_DDL);

    const [t] = readSchema(p, true).filter((x) => x.table === "users");
    expect(t).toBeDefined();

    // Inline UNIQUE on email + named UNIQUE over (org_id, email) → two unique
    // signatures, by column SET. The PRIMARY KEY (id) must NOT appear here.
    expect(new Set(t.uniqueSignatures)).toEqual(
      new Set([
        uniqueColumnSignature(["email"]),
        uniqueColumnSignature(["org_id", "email"]),
      ]),
    );
    expect(t.uniqueSignatures).not.toContain(uniqueColumnSignature(["id"]));

    // Named (non-autoindex) indexes only — the inline-unique autoindex on email
    // is excluded from `indexes`.
    expect(new Set(t.indexes)).toEqual(
      new Set([
        "users_name_idx",
        "users_org_email_uq",
        "users_org_name_idx",
        "users_name_desc_idx",
      ]),
    );

    // Ordered column lists per named index (seqno order); DESC reported without
    // direction, so it is just ["name"].
    expect(t.namedIndexColumns.users_name_idx).toEqual(["name"]);
    expect(t.namedIndexColumns.users_org_email_uq).toEqual(["org_id", "email"]);
    expect(t.namedIndexColumns.users_org_name_idx).toEqual(["org_id", "name"]);
    expect(t.namedIndexColumns.users_name_desc_idx).toEqual(["name"]);

    // The PK column carries the pk flag (so PK identity is covered elsewhere).
    const id = t.columns.find((c) => c.name === "id")!;
    expect(id.pk).toBe(1);
  });

  it("reports NO drift between two identical real DBs (no false positive)", () => {
    const a = join(dir, "expected.db");
    const b = join(dir, "live-match.db");
    makeDb(a, BASE_DDL);
    makeDb(b, BASE_DDL);

    const report = diffSchemas(readSchema(a, true), readSchema(b, true));
    expect(report.hasDrift).toBe(false);
    expect(report.tables).toHaveLength(0);
  });

  it("detects a DROPPED inline .unique() on a real live DB", () => {
    const expected = join(dir, "exp-uq.db");
    const live = join(dir, "live-no-uq.db");
    makeDb(expected, BASE_DDL);
    // Live is the same schema but email is NOT unique (the table-rebuild
    // db:push would have skipped on a populated table).
    makeDb(
      live,
      BASE_DDL.replace("email TEXT UNIQUE", "email TEXT"),
    );

    const report = diffSchemas(readSchema(expected, true), readSchema(live, true));
    expect(report.hasDrift).toBe(true);
    const users = report.tables.find((t) => t.table === "users")!;
    expect(users.missingUniqueConstraints).toEqual([
      uniqueColumnSignature(["email"]),
    ]);
  });

  it("detects a same-NAME index whose column ORDER changed on a real live DB", () => {
    const expected = join(dir, "exp-idx.db");
    const live = join(dir, "live-idx.db");
    makeDb(expected, BASE_DDL);
    // Live keeps the SAME index name but flips the column order.
    makeDb(
      live,
      BASE_DDL.replace(
        "CREATE INDEX users_org_name_idx ON users (org_id, name);",
        "CREATE INDEX users_org_name_idx ON users (name, org_id);",
      ),
    );

    const report = diffSchemas(readSchema(expected, true), readSchema(live, true));
    expect(report.hasDrift).toBe(true);
    const users = report.tables.find((t) => t.table === "users")!;
    expect(users.changedIndexes).toEqual([
      {
        index: "users_org_name_idx",
        expectedColumns: ["org_id", "name"],
        liveColumns: ["name", "org_id"],
      },
    ]);
  });

  it("does NOT flag an EXTRA live unique constraint or index (one-way policy)", () => {
    const expected = join(dir, "exp-min.db");
    const live = join(dir, "live-extra.db");
    makeDb(expected, BASE_DDL);
    // Live has an additional unique constraint + index schema.ts never declared.
    makeDb(
      live,
      BASE_DDL +
        "\nCREATE UNIQUE INDEX users_name_uq ON users (name);" +
        "\nCREATE INDEX users_email_idx ON users (email);",
    );

    const report = diffSchemas(readSchema(expected, true), readSchema(live, true));
    expect(report.hasDrift).toBe(false);
  });

  it("ignores a case-only declared-type difference end-to-end (real libsql)", () => {
    const expected = join(dir, "exp-case.db");
    const live = join(dir, "live-case.db");
    makeDb(expected, "CREATE TABLE t (id TEXT PRIMARY KEY NOT NULL, n INTEGER);");
    // Same logical types, lowercased — must not be drift.
    makeDb(live, "CREATE TABLE t (id text PRIMARY KEY NOT NULL, n integer);");

    const expSchema: TableCols[] = readSchema(expected, true);
    const liveSchema: TableCols[] = readSchema(live, true);
    const report = diffSchemas(expSchema, liveSchema);
    expect(report.hasDrift).toBe(false);
  });
});
