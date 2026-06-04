import { describe, it, expect } from "vitest";
import { SQLiteTable, getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core";
import { PgTable, getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import * as sqliteSchema from "../schema.sqlite";
import * as pgSchema from "../schema.pg";

/**
 * RUNTIME drift guard (fast suite — no docker).
 *
 * Complements the compile-time `schema-parity.test.ts` by inspecting the
 * actual Drizzle table objects via `getTableConfig`. Where the type test proves
 * the inferred TS row types match, this proves the PHYSICAL shape matches: the
 * same set of tables, the same set of physical column NAMES per table, and the
 * same primary-key column set. A divergence here (e.g. a column renamed in one
 * generated dialect file, an added/dropped column, or a different PK) means the
 * two backends would store data under different layouts — caught before any
 * data ever touches a database.
 */

/** Collect `sqlName -> { columns, pk }` for the SQLite schema. */
function sqliteShape(): Map<string, { columns: Set<string>; pk: Set<string> }> {
  const out = new Map<string, { columns: Set<string>; pk: Set<string> }>();
  for (const value of Object.values(sqliteSchema)) {
    if (!(value instanceof SQLiteTable)) continue;
    const cfg = getSqliteTableConfig(value);
    const columns = new Set(cfg.columns.map((c) => c.name));
    const pk = new Set<string>([
      ...cfg.columns.filter((c) => c.primary).map((c) => c.name),
      ...cfg.primaryKeys.flatMap((p) => p.columns.map((c) => c.name)),
    ]);
    out.set(cfg.name, { columns, pk });
  }
  return out;
}

/** Collect `sqlName -> { columns, pk }` for the Postgres schema. */
function pgShape(): Map<string, { columns: Set<string>; pk: Set<string> }> {
  const out = new Map<string, { columns: Set<string>; pk: Set<string> }>();
  for (const value of Object.values(pgSchema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getPgTableConfig(value);
    const columns = new Set(cfg.columns.map((c) => c.name));
    const pk = new Set<string>([
      ...cfg.columns.filter((c) => c.primary).map((c) => c.name),
      ...cfg.primaryKeys.flatMap((p) => p.columns.map((c) => c.name)),
    ]);
    out.set(cfg.name, { columns, pk });
  }
  return out;
}

describe("schema column diff (sqlite-core vs pg-core)", () => {
  const sqlite = sqliteShape();
  const pg = pgShape();

  it("defines the identical set of tables in both dialects", () => {
    const sqliteTables = [...sqlite.keys()].sort();
    const pgTables = [...pg.keys()].sort();
    expect(pgTables).toEqual(sqliteTables);
    // Sanity: the full schema is 64 tables (+1 notification_preferences y5ch.6,
    // +2 model_proxy_token/model_usage_event aehq).
    expect(sqliteTables).toHaveLength(64);
  });

  // One assertion per table so a failure names the offending table.
  for (const sqlName of [...sqliteShape().keys()].sort()) {
    it(`table "${sqlName}" has identical column names + PK across dialects`, () => {
      const s = sqlite.get(sqlName);
      const p = pg.get(sqlName);
      expect(s, `sqlite missing ${sqlName}`).toBeDefined();
      expect(p, `pg missing ${sqlName}`).toBeDefined();
      expect([...p!.columns].sort()).toEqual([...s!.columns].sort());
      expect([...p!.pk].sort()).toEqual([...s!.pk].sort());
    });
  }
});
