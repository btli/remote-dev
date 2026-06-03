/**
 * Structural snapshot tool for Drizzle schema modules.
 *
 * Imports a schema module (sqlite OR pg dialect) and, for every exported
 * Drizzle table, emits a normalized, deterministically-sorted JSON description
 * of its structure: table sql-name, columns ({name, sqlType, notNull,
 * primaryKey, hasDefault, isUnique}), indexes ({name, columns, unique}),
 * composite primary-key columns, and foreign keys ({columns, foreignTable,
 * foreignColumns, onDelete}).
 *
 * This is the acceptance oracle for the schema codegen: the snapshot of the
 * generated `schema.sqlite.ts` MUST deep-equal the snapshot of the original
 * hand-written `schema.ts`. That proves SQLite behavior is unchanged.
 *
 * Usage:
 *   bun run scripts/schema-structural-snapshot.ts <module-path> [--out <file>] [--dialect sqlite|pg]
 *
 * The module path is resolved relative to the repo root. If --dialect is
 * omitted it is auto-detected by probing both dialect's getTableConfig.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { getTableConfig as sqliteGetTableConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgGetTableConfig } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { PgTable } from "drizzle-orm/pg-core";

interface ColumnSnapshot {
  name: string;
  sqlType: string;
  notNull: boolean;
  primaryKey: boolean;
  hasDefault: boolean;
  isUnique: boolean;
}

interface IndexSnapshot {
  name: string | undefined;
  unique: boolean;
  columns: string[];
}

interface ForeignKeySnapshot {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string | undefined;
}

interface TableSnapshot {
  table: string;
  columns: ColumnSnapshot[];
  compositePrimaryKey: string[][];
  indexes: IndexSnapshot[];
  foreignKeys: ForeignKeySnapshot[];
}

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

function tableSqlName(table: unknown): string {
  const t = table as Record<symbol, unknown>;
  const name = t[DRIZZLE_NAME];
  return typeof name === "string" ? name : "<unknown>";
}

function indexColumnNames(columns: readonly unknown[]): string[] {
  return columns.map((c) => {
    const col = c as { name?: unknown };
    return typeof col.name === "string" ? col.name : String(c);
  });
}

function snapshotTable(table: unknown): TableSnapshot {
  const isPg = is(table, PgTable);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg: any = isPg ? pgGetTableConfig(table as never) : sqliteGetTableConfig(table as never);

  const columns: ColumnSnapshot[] = cfg.columns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((col: any) => ({
      name: col.name as string,
      sqlType: col.getSQLType() as string,
      notNull: Boolean(col.notNull),
      primaryKey: Boolean(col.primary),
      hasDefault: Boolean(col.hasDefault),
      isUnique: Boolean(col.isUnique),
    }))
    .sort((a: ColumnSnapshot, b: ColumnSnapshot) => a.name.localeCompare(b.name));

  const compositePrimaryKey: string[][] = (cfg.primaryKeys ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((pk: any) => pk.columns.map((c: any) => c.name as string))
    .sort((a: string[], b: string[]) => a.join(",").localeCompare(b.join(",")));

  const indexes: IndexSnapshot[] = (cfg.indexes ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((ix: any) => ({
      name: ix.config.name as string | undefined,
      unique: Boolean(ix.config.unique),
      columns: indexColumnNames(ix.config.columns),
    }))
    .sort((a: IndexSnapshot, b: IndexSnapshot) =>
      String(a.name).localeCompare(String(b.name))
    );

  const foreignKeys: ForeignKeySnapshot[] = (cfg.foreignKeys ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((fk: any) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c: { name: string }) => c.name),
        foreignTable: tableSqlName(ref.foreignTable),
        foreignColumns: ref.foreignColumns.map((c: { name: string }) => c.name),
        onDelete: fk.onDelete as string | undefined,
      };
    })
    .sort((a: ForeignKeySnapshot, b: ForeignKeySnapshot) => {
      const ka = `${a.columns.join(",")}->${a.foreignTable}.${a.foreignColumns.join(",")}:${a.onDelete}`;
      const kb = `${b.columns.join(",")}->${b.foreignTable}.${b.foreignColumns.join(",")}:${b.onDelete}`;
      return ka.localeCompare(kb);
    });

  return {
    table: tableSqlName(table),
    columns,
    compositePrimaryKey,
    indexes,
    foreignKeys,
  };
}

function isDrizzleTable(value: unknown): boolean {
  return is(value, SQLiteTable) || is(value, PgTable);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let outFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      outFile = args[++i];
    } else if (args[i] === "--dialect") {
      // dialect auto-detected per-table; flag accepted for documentation only
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  const modulePath = positional[0];
  if (!modulePath) {
    throw new Error(
      "usage: schema-structural-snapshot.ts <module-path> [--out <file>]"
    );
  }

  const absolute = resolve(process.cwd(), modulePath);
  const mod: Record<string, unknown> = await import(pathToFileURL(absolute).href);

  const tables: TableSnapshot[] = [];
  for (const exportName of Object.keys(mod)) {
    const value = mod[exportName];
    if (isDrizzleTable(value)) {
      tables.push(snapshotTable(value));
    }
  }

  tables.sort((a, b) => a.table.localeCompare(b.table));

  const snapshot = {
    tableCount: tables.length,
    columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
    tables,
  };

  const json = JSON.stringify(snapshot, null, 2);
  if (outFile) {
    writeFileSync(resolve(process.cwd(), outFile), json + "\n", "utf8");
    process.stdout.write(
      `wrote ${outFile}: ${snapshot.tableCount} tables, ${snapshot.columnCount} columns\n`
    );
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  process.exit(1);
});
