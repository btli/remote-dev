// @vitest-environment node
/**
 * Shared test-DB helper for the server-to-server migration suites.
 *
 * The import/export services touch ~20 tables, so hand-written DDL (the
 * pattern smaller suites use) would drift from the real schema. Instead the
 * FULL SQLite schema is generated programmatically from the real dialect
 * module via `drizzle-kit/api` (empty snapshot → current snapshot) and
 * applied to a temp-file libsql database. The DDL is computed once per
 * process and replayed per test.
 *
 * Not a test file itself (no `.test.` suffix) — vitest does not collect it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import * as schema from "@/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbHandle {
  client: Client;
  db: TestDb;
  /** Temp dir holding the db file (caller may also use it as RDV_DATA_DIR). */
  dir: string;
  cleanup(): void;
}

let ddlPromise: Promise<string[]> | null = null;

/** Full CREATE TABLE/INDEX statement list for the current SQLite schema. */
export function schemaDdl(): Promise<string[]> {
  if (!ddlPromise) {
    ddlPromise = (async () => {
      const empty = await generateSQLiteDrizzleJson({});
      const current = await generateSQLiteDrizzleJson(
        schema as unknown as Record<string, unknown>,
      );
      return generateSQLiteMigration(empty, current);
    })();
  }
  return ddlPromise;
}

/**
 * Create a fresh temp-file libsql database with the full schema applied.
 * A file URL (not `:memory:`) so every connection sees the same schema.
 */
export async function createTestDb(prefix = "rdv-migration-test-"): Promise<TestDbHandle> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  const db = drizzle(client, { schema });
  for (const statement of await schemaDdl()) {
    await client.execute(statement);
  }
  return {
    client,
    db,
    dir,
    cleanup: () => {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
