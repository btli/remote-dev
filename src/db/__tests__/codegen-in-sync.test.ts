import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractTypeImports,
  generateSchemas,
  type SchemaDefinition,
} from "../../../scripts/lib/schema-codegen";

/**
 * THE primary codegen drift guard (fast suite — no docker).
 *
 * The three generated schema files (`schema.sqlite.ts`, `schema.pg.ts`, and the
 * `schema.ts` barrel) are produced from the hand-maintained `schema.def.ts` by
 * `scripts/lib/schema-codegen.ts` `generateSchemas`. This test regenerates them
 * IN MEMORY from the committed def and asserts the output is byte-for-byte
 * identical to what is checked into git.
 *
 * It catches every "the generated files are stale" failure mode:
 *   - editing a generated file directly without updating `schema.def.ts`
 *   - changing `schema.def.ts` (or the generator) and forgetting to re-run
 *     `bun run db:codegen` before committing
 *   - a merge that picks up a def change but not the regenerated output
 *
 * Both apps that share the generator core are covered: the main app (here) and
 * the supervisor app (its `schema.def.ts` + committed generated files). The
 * supervisor def is imported via a relative path; its `import type` lines are
 * erased at runtime, and its `schema` export is plain data, so cross-package
 * import is safe.
 */

const ROOT = resolve(__dirname, "../../..");

/**
 * Reproduce a per-app codegen caller in memory and compare the three emitted
 * strings against the committed files. `barrelTypeReExports` mirrors what each
 * app's `scripts/codegen-schema.ts` passes (the main app passes none; the
 * supervisor passes its brand + row-type re-exports).
 */
async function assertInSync(opts: {
  defPath: string;
  sqlitePath: string;
  pgPath: string;
  barrelPath: string;
  barrelTypeReExports?: string;
}): Promise<void> {
  const defSource = readFileSync(opts.defPath, "utf8");
  const typeImports = extractTypeImports(defSource);
  const mod: { schema: SchemaDefinition } = await import(opts.defPath);
  const { sqlite, pg, barrel } = generateSchemas(mod.schema, {
    typeImports,
    barrelTypeReExports: opts.barrelTypeReExports,
  });

  expect(sqlite, `${opts.sqlitePath} is stale — run \`bun run db:codegen\``).toBe(
    readFileSync(opts.sqlitePath, "utf8")
  );
  expect(pg, `${opts.pgPath} is stale — run \`bun run db:codegen\``).toBe(
    readFileSync(opts.pgPath, "utf8")
  );
  expect(barrel, `${opts.barrelPath} is stale — run \`bun run db:codegen\``).toBe(
    readFileSync(opts.barrelPath, "utf8")
  );
}

describe("codegen output is in sync with schema.def.ts", () => {
  it("main app: schema.sqlite.ts / schema.pg.ts / schema.ts match the def", async () => {
    await assertInSync({
      defPath: resolve(ROOT, "src/db/schema.def.ts"),
      sqlitePath: resolve(ROOT, "src/db/schema.sqlite.ts"),
      pgPath: resolve(ROOT, "src/db/schema.pg.ts"),
      barrelPath: resolve(ROOT, "src/db/schema.ts"),
      // The main app's caller passes no extra barrel re-exports.
    });
  });

  it("supervisor app: schema.sqlite.ts / schema.pg.ts / schema.ts match the def", async () => {
    // Mirrors apps/supervisor/scripts/codegen-schema.ts BARREL_TYPE_RE_EXPORTS
    // exactly — if that caller changes, this string must change too (and a
    // mismatch surfaces as a barrel byte-diff here).
    const supervisorBarrelReExports = [
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

    await assertInSync({
      defPath: resolve(ROOT, "apps/supervisor/src/db/schema.def.ts"),
      sqlitePath: resolve(ROOT, "apps/supervisor/src/db/schema.sqlite.ts"),
      pgPath: resolve(ROOT, "apps/supervisor/src/db/schema.pg.ts"),
      barrelPath: resolve(ROOT, "apps/supervisor/src/db/schema.ts"),
      barrelTypeReExports: supervisorBarrelReExports,
    });
  });
});
