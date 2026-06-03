/**
 * Shared schema-codegen core (dialect-agnostic).
 *
 * This module is the single source of truth for BOTH the DSL type vocabulary
 * (`ColumnKind`, `ColumnDefinition`, `IndexDefinition`, `TableDefinition`,
 * `SchemaDefinition`) used by the hand-maintained `schema.def.ts` files AND the
 * emission logic that turns a neutral `SchemaDefinition` into the three
 * generated dialect files (`schema.sqlite.ts`, `schema.pg.ts`, and the runtime
 * dialect-switch barrel `schema.ts`).
 *
 * Two apps reuse this core, each with its OWN `schema.def.ts`:
 *   - the main app          (src/db/schema.def.ts            → scripts/codegen-schema.ts)
 *   - the supervisor app    (apps/supervisor/src/db/schema.def.ts → apps/supervisor/scripts/codegen-schema.ts)
 *
 * `generateSchemas()` is PURE: given the parsed `SchemaDefinition`, the verbatim
 * type-import block extracted from the def source, and a few presentational
 * options, it returns the three file contents as strings. The thin per-app
 * callers handle file I/O.
 *
 * Mapping (identical across both apps):
 *   boolean      → boolean (pg) / integer{mode:boolean}      (sqlite)
 *   timestampMs  → timestamptz (pg) / integer{mode:timestamp_ms} (sqlite)
 *   timestampS   → timestamptz (pg) / integer{mode:timestamp}    (sqlite)
 *   json         → jsonb (pg) / text{mode:json}              (sqlite)
 *   text/integer → text/integer (both)
 */

// ---------------------------------------------------------------------------
// DSL types (the vocabulary of every schema.def.ts)
// ---------------------------------------------------------------------------

export type ColumnKind =
  | "text"
  | "integer"
  | "boolean"
  | "timestampMs"
  | "timestampS"
  | "json";

/** A literal value default (`.default(value)`). */
export interface DefaultValue {
  kind: "value";
  /** Emitted verbatim as the argument to `.default(...)`. */
  value: string;
}
/** A well-known default function. */
export interface DefaultFn {
  kind: "fn";
  /** "uuid" => crypto.randomUUID(); "now" => new Date(). */
  fn: "uuid" | "now";
}
/** A raw arrow-body expression for `.$defaultFn(() => <expr>)`, emitted verbatim. */
export interface DefaultRaw {
  kind: "raw";
  expr: string;
}
export type ColumnDefault = DefaultValue | DefaultFn | DefaultRaw;

export interface ColumnReference {
  /** Export name of the referenced table in this file. */
  table: string;
  /** JS field name of the referenced column. */
  column: string;
  onDelete?: "cascade" | "set null" | "restrict" | "no action" | "set default";
  /** True for a self-FK (needs an explicit AnyXColumn return-type cast). */
  selfRef?: boolean;
}

export interface ColumnDefinition {
  /** JS property name on the table object. */
  field: string;
  /** Physical column name in the database. */
  dbName: string;
  kind: ColumnKind;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  /** `{ enum: [...] }` option — narrows the inferred TS type; SQL type unchanged. */
  enumValues?: string[];
  /** TS type name(s) for `.$type<X>()`; emitted verbatim into both dialects. */
  typeBrand?: string;
  default?: ColumnDefault;
  /** Emit `.$onUpdateFn(() => new Date())` (timestamp auto-bump on UPDATE). */
  onUpdateNow?: boolean;
  references?: ColumnReference;
}

export interface IndexDefinition {
  name: string;
  /** JS field names. */
  columns: string[];
  unique?: boolean;
  /**
   * Skip emitting this explicit index for the Postgres dialect.
   *
   * Use only when a column-level `unique: true` on the same column already
   * auto-creates a backing index with the IDENTICAL name in Postgres — there,
   * emitting an explicit `CREATE UNIQUE INDEX` of the same name collides
   * (Postgres error 42P07). On SQLite an inline UNIQUE plus a named index
   * coexist harmlessly, and the live SQLite DBs already carry both, so the
   * SQLite output keeps emitting this index unchanged.
   */
  omitForPg?: boolean;
}

export interface TableDefinition {
  /** Exported JS const name (e.g. "users"). */
  exportName: string;
  /** Physical table name (e.g. "user"). */
  sqlName: string;
  columns: ColumnDefinition[];
  /** Composite primary key (JS field names) when present. */
  primaryKey?: string[];
  indexes?: IndexDefinition[];
}

export type SchemaDefinition = TableDefinition[];

// ---------------------------------------------------------------------------
// Generation options + result
// ---------------------------------------------------------------------------

/** Presentational knobs the per-app caller supplies. */
export interface GenerateOptions {
  /**
   * The verbatim leading `import ...` block extracted from the def source. It is
   * re-emitted into BOTH dialect files so the generated `.$type<X>()` brands
   * resolve to the same TS types as before.
   */
  typeImports: string;
  /**
   * Extra lines appended to the barrel AFTER the table destructuring. The
   * supervisor uses this to re-export its standalone brand types and the
   * `$inferSelect` row-type aliases that `@/db/schema` consumers depend on. The
   * main app passes nothing (its consumers only import table consts).
   */
  barrelTypeReExports?: string;
}

export interface GeneratedSchemas {
  sqlite: string;
  pg: string;
  barrel: string;
}

const BANNER =
  "// AUTO-GENERATED by scripts/codegen-schema.ts — DO NOT EDIT.\n" +
  "// Edit schema.def.ts and run `bun run db:codegen`.\n";

/**
 * Extract the verbatim type-import block from the top of a schema.def.ts.
 *
 * Handles BOTH single-line imports and multi-line `import type { ... } from`
 * blocks: once an import line opens, every subsequent line is captured until the
 * statement terminates with a `;`. Stops at the first top-level `export type` /
 * `export interface` declaration (the DSL re-export / type vocabulary), so only
 * the leading brand-import statements are copied into the generated files.
 */
export function extractTypeImports(defSource: string): string {
  const lines = defSource.split("\n");
  const imports: string[] = [];
  let inImport = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inImport) {
      imports.push(line);
      // A statement ends at the first line whose trimmed text ends with `;`.
      if (trimmed.endsWith(";")) inImport = false;
      continue;
    }
    if (trimmed.startsWith("import ")) {
      imports.push(line);
      // Single-line imports end on the same line; multi-line ones continue.
      if (!trimmed.endsWith(";")) inImport = true;
      continue;
    }
    // Stop once we reach the first type/interface declaration (only when not
    // mid-import — guarded by the `inImport` branch above).
    if (trimmed.startsWith("export type") || trimmed.startsWith("export interface")) {
      break;
    }
  }
  return imports.join("\n");
}

// ---------------------------------------------------------------------------
// Default emission (shared across dialects — same TS at runtime).
// ---------------------------------------------------------------------------
function emitDefaultChain(def: ColumnDefault): string {
  switch (def.kind) {
    case "value":
      return `.default(${def.value})`;
    case "fn":
      return def.fn === "uuid"
        ? `.$defaultFn(() => crypto.randomUUID())`
        : `.$defaultFn(() => new Date())`;
    case "raw":
      return `.$defaultFn(() => ${def.expr})`;
  }
}

/** Common modifier chain (notNull/unique/default/onUpdate + $type brand) shared by both dialects. */
function emitSharedModifiers(col: ColumnDefinition): string {
  let chain = "";
  if (col.typeBrand) chain += `.$type<${col.typeBrand}>()`;
  if (col.notNull) chain += `.notNull()`;
  if (col.unique) chain += `.unique()`;
  if (col.default) chain += emitDefaultChain(col.default);
  if (col.onUpdateNow) chain += `.$onUpdateFn(() => new Date())`;
  return chain;
}

// ---------------------------------------------------------------------------
// SQLite column builder
// ---------------------------------------------------------------------------
function sqliteColumnBuilder(col: ColumnDefinition): string {
  const name = JSON.stringify(col.dbName);
  switch (col.kind) {
    case "text":
      return col.enumValues
        ? `text(${name}, { enum: ${JSON.stringify(col.enumValues)} })`
        : `text(${name})`;
    case "json":
      return `text(${name}, { mode: "json" })`;
    case "integer":
      return `integer(${name})`;
    case "boolean":
      return `integer(${name}, { mode: "boolean" })`;
    case "timestampMs":
      return `integer(${name}, { mode: "timestamp_ms" })`;
    case "timestampS":
      return `integer(${name}, { mode: "timestamp" })`;
  }
}

// ---------------------------------------------------------------------------
// Postgres column builder
// ---------------------------------------------------------------------------
function pgColumnBuilder(col: ColumnDefinition): string {
  const name = JSON.stringify(col.dbName);
  switch (col.kind) {
    case "text":
      return col.enumValues
        ? `text(${name}, { enum: ${JSON.stringify(col.enumValues)} })`
        : `text(${name})`;
    case "json":
      return `jsonb(${name})`;
    case "integer":
      return `integer(${name})`;
    case "boolean":
      return `boolean(${name})`;
    case "timestampMs":
    case "timestampS":
      return `timestamp(${name}, { withTimezone: true, mode: "date" })`;
  }
}

// ---------------------------------------------------------------------------
// References emission (dialect-specific only for the self-ref cast type).
// ---------------------------------------------------------------------------
function emitReferences(col: ColumnDefinition, anyColumnType: string): string {
  const ref = col.references;
  if (!ref) return "";
  const opts = ref.onDelete ? `, { onDelete: ${JSON.stringify(ref.onDelete)} }` : "";
  if (ref.selfRef) {
    // Self-FK: drizzle needs an explicit return-type annotation to break the
    // circular type inference (the table references its own column).
    return `.references((): ${anyColumnType} => ${ref.table}.${ref.column}${opts})`;
  }
  return `.references(() => ${ref.table}.${ref.column}${opts})`;
}

// ---------------------------------------------------------------------------
// Column line
// ---------------------------------------------------------------------------
function emitColumnLine(
  col: ColumnDefinition,
  builder: (c: ColumnDefinition) => string,
  anyColumnType: string
): string {
  let line = `    ${col.field}: ${builder(col)}`;
  if (col.primaryKey) line += `.primaryKey()`;
  line += emitSharedModifiers(col);
  line += emitReferences(col, anyColumnType);
  line += ",";
  return line;
}

// ---------------------------------------------------------------------------
// Table extras callback (indexes + composite PK)
// ---------------------------------------------------------------------------
function emitExtras(table: TableDefinition, dialect: "sqlite" | "pg"): string {
  const lines: string[] = [];
  if (table.primaryKey) {
    const cols = table.primaryKey.map((c) => `table.${c}`).join(", ");
    lines.push(`    primaryKey({ columns: [${cols}] }),`);
  }
  for (const idx of table.indexes ?? []) {
    // Per-index dialect skip: a column-level `unique` auto-creates an
    // identically-named backing index in Postgres, so emitting an explicit
    // index of the same name would collide (42P07). SQLite tolerates both, and
    // the live SQLite DBs already carry the explicit index, so it stays there.
    if (dialect === "pg" && idx.omitForPg) continue;
    const fn = idx.unique ? "uniqueIndex" : "index";
    const cols = idx.columns.map((c) => `table.${c}`).join(", ");
    lines.push(`    ${fn}(${JSON.stringify(idx.name)}).on(${cols}),`);
  }
  if (lines.length === 0) return "";
  return `,\n  (table) => [\n${lines.join("\n")}\n  ]`;
}

// ---------------------------------------------------------------------------
// Table emission
// ---------------------------------------------------------------------------
function emitTable(
  table: TableDefinition,
  tableFn: string,
  builder: (c: ColumnDefinition) => string,
  anyColumnType: string,
  dialect: "sqlite" | "pg"
): string {
  const cols = table.columns
    .map((c) => emitColumnLine(c, builder, anyColumnType))
    .join("\n");
  const extras = emitExtras(table, dialect);
  return `export const ${table.exportName} = ${tableFn}(\n  ${JSON.stringify(
    table.sqlName
  )},\n  {\n${cols}\n  }${extras}\n);`;
}

// ---------------------------------------------------------------------------
// Import feature detection
// ---------------------------------------------------------------------------
/**
 * Which optional drizzle imports the emitted code actually references. Computed
 * so a schema that doesn't use (say) json or unique indexes doesn't import an
 * unused builder — that would trip `no-unused-vars` in the generated file. A
 * schema exercising every feature (the main app) keeps importing the full set,
 * so its output is unchanged.
 */
interface ImportUsage {
  composite: boolean; // composite primary key → `primaryKey`
  plainIndex: boolean; // a non-unique index → `index`
  uniqueIndexSqlite: boolean; // a unique index emitted for sqlite → `uniqueIndex`
  uniqueIndexPg: boolean; // a unique index emitted for pg (after omitForPg)
  selfRef: boolean; // a self-FK → `AnyXColumn`
  boolean: boolean; // a boolean column → pg `boolean`
  timestamp: boolean; // a timestamp column → pg `timestamp`
  json: boolean; // a json column → pg `jsonb`
}

function detectImportUsage(schema: SchemaDefinition): ImportUsage {
  const u: ImportUsage = {
    composite: false,
    plainIndex: false,
    uniqueIndexSqlite: false,
    uniqueIndexPg: false,
    selfRef: false,
    boolean: false,
    timestamp: false,
    json: false,
  };
  for (const t of schema) {
    if (t.primaryKey) u.composite = true;
    for (const idx of t.indexes ?? []) {
      if (idx.unique) {
        u.uniqueIndexSqlite = true;
        if (!idx.omitForPg) u.uniqueIndexPg = true;
      } else {
        u.plainIndex = true;
      }
    }
    for (const c of t.columns) {
      if (c.references?.selfRef) u.selfRef = true;
      if (c.kind === "boolean") u.boolean = true;
      if (c.kind === "timestampMs" || c.kind === "timestampS") u.timestamp = true;
      if (c.kind === "json") u.json = true;
    }
  }
  return u;
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------
function generateSqlite(schema: SchemaDefinition, typeImports: string): string {
  const u = detectImportUsage(schema);
  // SQLite stores boolean/timestamp/json on `integer`/`text`, so those imports
  // are always present whenever any table exists; only index/pk vary.
  const named = ["sqliteTable", "text", "integer"];
  if (u.plainIndex) named.push("index");
  if (u.uniqueIndexSqlite) named.push("uniqueIndex");
  if (u.composite) named.push("primaryKey");
  const importLines = [
    `import { ${named.join(", ")} } from "drizzle-orm/sqlite-core";`,
  ];
  if (u.selfRef) {
    importLines.push(`import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";`);
  }
  const imports = [BANNER, ...importLines, typeImports, ""].join("\n");
  const tables = schema
    .map((t) => emitTable(t, "sqliteTable", sqliteColumnBuilder, "AnySQLiteColumn", "sqlite"))
    .join("\n\n");
  return `${imports}\n${tables}\n`;
}

function generatePg(schema: SchemaDefinition, typeImports: string): string {
  const u = detectImportUsage(schema);
  const named = ["pgTable", "text", "integer"];
  if (u.boolean) named.push("boolean");
  if (u.timestamp) named.push("timestamp");
  if (u.json) named.push("jsonb");
  if (u.plainIndex) named.push("index");
  if (u.uniqueIndexPg) named.push("uniqueIndex");
  if (u.composite) named.push("primaryKey");
  const importLines = [
    `import { ${named.join(", ")} } from "drizzle-orm/pg-core";`,
  ];
  if (u.selfRef) {
    importLines.push(`import type { AnyPgColumn } from "drizzle-orm/pg-core";`);
  }
  const imports = [BANNER, ...importLines, typeImports, ""].join("\n");
  const tables = schema
    .map((t) => emitTable(t, "pgTable", pgColumnBuilder, "AnyPgColumn", "pg"))
    .join("\n\n");
  return `${imports}\n${tables}\n`;
}

function generateBarrel(
  schema: SchemaDefinition,
  barrelTypeReExports?: string
): string {
  const names = schema.map((t) => t.exportName);
  // Emit the destructuring list one-per-line for readability + stable diffs.
  const destructure = names.map((n) => `  ${n},`).join("\n");
  const extras = barrelTypeReExports ? `\n${barrelTypeReExports}\n` : "";
  return `${BANNER}// Runtime dialect switch: consumers import { table } from "@/db/schema" and
// transparently receive the SQLite or Postgres table object depending on
// DATABASE_URL. The cast to \`typeof sqliteSchema\` keeps consumer TYPES stable —
// $inferSelect/$inferInsert are identical across dialects by construction.
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";
import { isPostgres } from "./is-postgres";

const active = (isPostgres() ? pgSchema : sqliteSchema) as typeof sqliteSchema;

export const {
${destructure}
} = active;
${extras}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate the three dialect files from a neutral `SchemaDefinition`. Pure: no
 * file I/O — the per-app caller writes the returned strings.
 */
export function generateSchemas(
  schema: SchemaDefinition,
  options: GenerateOptions
): GeneratedSchemas {
  return {
    sqlite: generateSqlite(schema, options.typeImports),
    pg: generatePg(schema, options.typeImports),
    barrel: generateBarrel(schema, options.barrelTypeReExports),
  };
}
