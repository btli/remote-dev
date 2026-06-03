/**
 * Schema codegen (MAIN app) — single source of truth in src/db/schema.def.ts.
 *
 * Thin caller around the shared generator core (scripts/lib/schema-codegen.ts).
 * Reads the neutral SchemaDefinition and emits THREE files:
 *   1. src/db/schema.sqlite.ts — drizzle sqlite-core tables (behavior-identical
 *      to the historical hand-written schema.ts).
 *   2. src/db/schema.pg.ts     — drizzle pg-core tables (structurally identical).
 *   3. src/db/schema.ts        — a barrel that re-exports the active dialect at
 *      runtime so the ~83 `@/db/schema` consumers keep working unchanged.
 *
 * Run with: `bun run db:codegen`.
 *
 * The structural snapshot (scripts/schema-structural-snapshot.ts) proves the
 * generated SQLite schema deep-equals the original — the acceptance bar for
 * "SQLite behavior unchanged".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractTypeImports,
  generateSchemas,
  type SchemaDefinition,
} from "./lib/schema-codegen";

const ROOT = resolve(import.meta.dirname, "..");
const DEF_PATH = resolve(ROOT, "src/db/schema.def.ts");

async function main(): Promise<void> {
  const defSource = readFileSync(DEF_PATH, "utf8");
  const typeImports = extractTypeImports(defSource);

  const mod: { schema: SchemaDefinition } = await import(
    pathToFileURL(DEF_PATH).href
  );
  const schema = mod.schema;

  const { sqlite, pg, barrel } = generateSchemas(schema, { typeImports });

  writeFileSync(resolve(ROOT, "src/db/schema.sqlite.ts"), sqlite, "utf8");
  writeFileSync(resolve(ROOT, "src/db/schema.pg.ts"), pg, "utf8");
  writeFileSync(resolve(ROOT, "src/db/schema.ts"), barrel, "utf8");

  const colCount = schema.reduce((s, t) => s + t.columns.length, 0);
  process.stdout.write(
    `Codegen complete: ${schema.length} tables, ${colCount} columns\n` +
      `  src/db/schema.sqlite.ts (${sqlite.length} bytes)\n` +
      `  src/db/schema.pg.ts     (${pg.length} bytes)\n` +
      `  src/db/schema.ts        (${barrel.length} bytes, barrel)\n`
  );
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  process.exit(1);
});
