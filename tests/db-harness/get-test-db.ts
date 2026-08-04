/**
 * Per-test isolated Postgres database helper (Unit 11 B/C).
 *
 * Each call creates a fresh `test_<unique>` schema inside the shared container
 * (started by tests/db-harness/pg-setup.ts), applies the full `drizzle/pg`
 * DDL into that schema, and returns a Drizzle node-postgres handle bound to
 * `schema.pg` plus a raw `pg.Client`. Tests are isolated because every handle
 * runs with `search_path` pinned to its own schema.
 *
 * WHY DDL-rewrite instead of re-running the migrator:
 * The generated `drizzle/pg` migration hardcodes `REFERENCES "public"."..."` in
 * its FK constraints, so re-running the node-postgres migrator into a non-public
 * schema fails (FKs resolve against `public`, which is empty in an isolated
 * schema). We instead read the migration SQL, strip the `"public".` qualifier so
 * object refs resolve via `search_path`, split on Drizzle's
 * `--> statement-breakpoint`, and execute each statement against a client whose
 * `search_path` is the isolated schema. Every committed migration is applied in
 * filename order, so the isolated schema matches the generated schema rather
 * than remaining frozen at the original 0000 baseline.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as pgSchema from "@/db/schema.pg";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle/pg");

/** Cached, schema-stripped DDL statements (read once per process). */
let cachedStatements: string[] | undefined;

function getDdlStatements(): string[] {
  if (!cachedStatements) {
    const migrationFiles = readdirSync(MIGRATIONS_FOLDER)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    cachedStatements = migrationFiles.flatMap((name) => {
      const raw = readFileSync(path.join(MIGRATIONS_FOLDER, name), "utf8");
      // Drop the `"public".` qualifier so refs resolve against the test
      // schema's search_path; split into individual Drizzle statements.
      return raw
        .replaceAll('"public".', "")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
    });
  }
  return cachedStatements;
}

export interface TestDb {
  /** Drizzle handle bound to schema.pg, search_path pinned to the test schema. */
  db: NodePgDatabase<typeof pgSchema>;
  /** Raw pg client (same connection / search_path) for direct SQL. */
  client: Client;
  /** The isolated schema name (e.g. "test_ab12cd"). */
  schema: string;
  /** The container connection URI (from TEST_PG_URL). */
  url: string;
  /** Drop the test schema (CASCADE) and end the client. */
  cleanup: () => Promise<void>;
}

function uniqueSchema(suffix?: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const base = suffix ? suffix.replace(/[^a-z0-9_]/gi, "").slice(0, 24) : "db";
  return `test_${base}_${rand}`.toLowerCase();
}

export async function getTestDb(suffix?: string): Promise<TestDb> {
  const url = process.env.TEST_PG_URL;
  if (!url) {
    throw new Error(
      "TEST_PG_URL is not set — the PG harness globalSetup must run first (use `bun run test:pg`)."
    );
  }

  const schema = uniqueSchema(suffix);

  // Admin connection: create the isolated schema.
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }

  // Working connection: search_path pinned to the test schema.
  const client = new Client({ connectionString: url, options: `-c search_path=${schema}` });
  await client.connect();

  // Apply the DDL into the isolated schema.
  for (const stmt of getDdlStatements()) {
    await client.query(stmt);
  }

  const db = drizzle(client, { schema: pgSchema });

  const cleanup = async (): Promise<void> => {
    try {
      // Drop the schema via the working client (search_path is irrelevant for a
      // fully-qualified DROP).
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  };

  return { db, client, schema, url, cleanup };
}
