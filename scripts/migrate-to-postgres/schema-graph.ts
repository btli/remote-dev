#!/usr/bin/env bun
/**
 * Schema dependency graph for the SQLite -> Postgres offline migration.
 *
 * Builds an FK dependency graph from the CONCRETE SQLite schema
 * (`src/db/schema.sqlite.ts`) using Drizzle's `getTableConfig`
 * (drizzle-orm/sqlite-core), then topologically sorts the tables into
 * dependency "tiers" (Kahn's algorithm) so that a table is always copied
 * AFTER every table it references. Tables within a single tier have no
 * dependencies on one another and may be copied concurrently.
 *
 * SELF-REFERENTIAL TABLES (`project_group.parentGroupId -> project_group.id`):
 * a self-edge would deadlock Kahn's algorithm, so self-edges are dropped from
 * the topo graph and the table is flagged `selfReferential`. The copy engine
 * handles ordering at the ROW level for these tables: it copies rows whose
 * self-FK is NULL first (roots), then repeatedly copies rows whose parent has
 * already landed, until the table is drained. This is the simpler of the two
 * correct approaches (the alternative — insert-with-null-then-UPDATE — needs a
 * second write pass per row; the wave approach is a pure read-order change).
 *
 * The barrel (`@/db/schema`) is intentionally NOT used here: it resolves to a
 * single dialect at import time based on DATABASE_URL. We import the concrete
 * SQLite tables directly so the graph reflects the SOURCE schema regardless of
 * what DATABASE_URL happens to be set to in the migrating process.
 */

import * as sqliteSchema from "../../src/db/schema.sqlite";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { getTableName } from "drizzle-orm";

/** Per-table metadata derived from the concrete SQLite schema. */
export interface TableInfo {
  /** Drizzle schema export key (e.g. `projectGroups`). */
  readonly exportKey: string;
  /** SQL table name (e.g. `project_group`). */
  readonly sqlName: string;
  /** The concrete SQLite table object (for reads via Drizzle libsql). */
  readonly sqliteTable: SQLiteTable;
  /** SQL names of tables this table references (self-edges excluded). */
  readonly dependsOn: ReadonlySet<string>;
  /** Primary-key column SQL names (single or composite). */
  readonly primaryKey: readonly string[];
  /** True when the table has an FK pointing at itself. */
  readonly selfReferential: boolean;
  /** SQL column name of the self-FK (only set when `selfReferential`). */
  readonly selfFkColumn: string | null;
}

/**
 * Enumerate every SQLite table export and collect its FK dependencies, primary
 * key, and self-reference status. Keyed by SQL table name.
 */
export function collectTables(): Map<string, TableInfo> {
  const tables = new Map<string, TableInfo>();

  for (const [exportKey, value] of Object.entries(sqliteSchema)) {
    if (!(value instanceof SQLiteTable)) continue;

    const cfg = getTableConfig(value);
    const sqlName = cfg.name;

    const dependsOn = new Set<string>();
    let selfReferential = false;
    let selfFkColumn: string | null = null;

    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const targetName = getTableName(ref.foreignTable);
      if (targetName === sqlName) {
        selfReferential = true;
        // A self-FK is single-column in this schema (parent_group_id).
        selfFkColumn = ref.columns[0]?.name ?? null;
        continue; // drop self-edges from the topo graph
      }
      dependsOn.add(targetName);
    }

    // Primary key: single-column PKs live on `column.primary`; composite PKs
    // live in the `primaryKeys` constraint list.
    const singlePk = cfg.columns.filter((c) => c.primary).map((c) => c.name);
    const compositePk = cfg.primaryKeys.flatMap((p) =>
      p.columns.map((c) => c.name)
    );
    const primaryKey = singlePk.length > 0 ? singlePk : compositePk;

    tables.set(sqlName, {
      exportKey,
      sqlName,
      sqliteTable: value,
      dependsOn,
      primaryKey,
      selfReferential,
      selfFkColumn,
    });
  }

  return tables;
}

/**
 * Kahn topological sort into dependency tiers. Tier 0 has no dependencies;
 * every table in tier N depends only on tables in tiers < N. Returns the
 * ordered list of tiers (each tier a list of SQL table names).
 *
 * `subset` (optional) restricts the graph to a chosen set of SQL table names
 * (used by `--tables`). Dependencies that fall outside the subset are ignored
 * for ordering — the caller is responsible for ensuring referenced rows exist.
 *
 * @throws if a cycle is detected among NON-self edges (should never happen for
 *   this schema, which is a DAG once self-edges are removed).
 */
export function topoSortTiers(
  tables: Map<string, TableInfo>,
  subset?: ReadonlySet<string>
): string[][] {
  const include = (name: string): boolean => !subset || subset.has(name);

  // Build in-degree restricted to included tables.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> [tables depending on it]

  for (const [name] of tables) {
    if (!include(name)) continue;
    inDegree.set(name, 0);
  }
  for (const [name, info] of tables) {
    if (!include(name)) continue;
    for (const dep of info.dependsOn) {
      if (!include(dep)) continue; // out-of-subset dep: ignore for ordering
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      const arr = dependents.get(dep) ?? [];
      arr.push(name);
      dependents.set(dep, arr);
    }
  }

  const tiers: string[][] = [];
  let frontier = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([name]) => name)
    .sort();

  let resolved = 0;
  const total = inDegree.size;

  while (frontier.length > 0) {
    tiers.push(frontier);
    resolved += frontier.length;
    const next: string[] = [];
    for (const name of frontier) {
      for (const dependent of dependents.get(name) ?? []) {
        const deg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0) next.push(dependent);
      }
    }
    frontier = next.sort();
  }

  if (resolved !== total) {
    const unresolved = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([name]) => name);
    throw new Error(
      `Cycle detected among non-self FK edges; unresolved tables: ${unresolved.join(", ")}`
    );
  }

  return tiers;
}
