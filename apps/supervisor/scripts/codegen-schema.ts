/**
 * Schema codegen (SUPERVISOR app) — single source of truth in
 * src/db/schema.def.ts.
 *
 * Thin caller around the shared generator core (root scripts/lib/schema-codegen.ts).
 * Reads the neutral SchemaDefinition and emits THREE files:
 *   1. src/db/schema.sqlite.ts — drizzle sqlite-core tables (behavior-identical
 *      to the historical hand-written schema.ts).
 *   2. src/db/schema.pg.ts     — drizzle pg-core tables (structurally identical).
 *   3. src/db/schema.ts        — a barrel that re-exports the active dialect at
 *      runtime PLUS the brand + row types the `@/db/schema` consumers depend on.
 *
 * Run with: `bun run db:codegen` (from apps/supervisor).
 *
 * The structural snapshot (root scripts/schema-structural-snapshot.ts) proves
 * the generated SQLite schema deep-equals the original hand-written schema —
 * the acceptance bar for "SQLite behavior unchanged".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractTypeImports,
  generateSchemas,
  type SchemaDefinition,
} from "../../../scripts/lib/schema-codegen";

const APP_ROOT = resolve(import.meta.dirname, "..");
const DEF_PATH = resolve(APP_ROOT, "src/db/schema.def.ts");

/**
 * Extra barrel exports the supervisor's `@/db/schema` consumers depend on: the
 * standalone brand types and the `$inferSelect` row-type aliases. The main app
 * needs none of these (its consumers only import table consts), which is why
 * this lives in the per-app caller rather than the shared core.
 */
const BARREL_TYPE_RE_EXPORTS = [
  `// Brand types (re-exported from the standalone module so \`@/db/schema\``,
  `// consumers keep importing them from here, unchanged).`,
  `export type { SupervisorRole, InstanceStatus, StorageTargetKind } from "./schema-types";`,
  ``,
  `// Inferred row types for convenience in services / route handlers. Derived`,
  `// from the ACTIVE dialect's tables, so they are identical across backends.`,
  `export type SupervisorUserRow = typeof supervisorUser.$inferSelect;`,
  `export type InstanceRow = typeof instance.$inferSelect;`,
  `export type RegisteredStorageTargetRow = typeof registeredStorageTarget.$inferSelect;`,
  `export type InstanceAuditLogRow = typeof instanceAuditLog.$inferSelect;`,
  `export type InstanceSeedRow = typeof instanceSeed.$inferSelect;`,
].join("\n");

async function main(): Promise<void> {
  const defSource = readFileSync(DEF_PATH, "utf8");
  const typeImports = extractTypeImports(defSource);

  const mod: { schema: SchemaDefinition } = await import(
    pathToFileURL(DEF_PATH).href
  );
  const schema = mod.schema;

  const { sqlite, pg, barrel } = generateSchemas(schema, {
    typeImports,
    barrelTypeReExports: BARREL_TYPE_RE_EXPORTS,
  });

  writeFileSync(resolve(APP_ROOT, "src/db/schema.sqlite.ts"), sqlite, "utf8");
  writeFileSync(resolve(APP_ROOT, "src/db/schema.pg.ts"), pg, "utf8");
  writeFileSync(resolve(APP_ROOT, "src/db/schema.ts"), barrel, "utf8");

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
