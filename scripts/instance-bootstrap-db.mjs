/**
 * Instance DB schema bootstrap (remote-dev-fmcq).
 *
 * A freshly-provisioned instance gets an EMPTY per-instance PVC, so its SQLite
 * DB has no schema — the scheduler can't start (the session_schedule table is
 * missing), the terminal server's /health returns 503, and readyz never passes.
 * The base app historically relies on `drizzle-kit push` at deploy time, which
 * is unavailable in the slim runtime image (no drizzle-kit / devDeps).
 *
 * This applies the full schema as idempotent `CREATE TABLE/INDEX IF NOT EXISTS`
 * statements (baked at build time via `drizzle-kit export`) using @libsql/client
 * — the same driver the app uses. Invoked by docker/entrypoint.sh BEFORE the
 * servers start, so the scheduler sees a populated schema.
 *
 * MUST run under `node` (NOT bun): bun crashes (exit 133, "embedder failed to
 * suspend thread") loading the @libsql native binding in this image.
 */
import { createClient } from "@libsql/client/node";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Mirror src/lib/paths.ts getDatabaseUrl():
// DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
function databaseUrl() {
  const e = process.env.DATABASE_URL;
  if (e) return e.startsWith("file:") ? e : `file:${e}`;
  const dir = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
  return `file:${join(dir, "sqlite.db")}`;
}

const schemaPath = new URL("../instance-bootstrap-schema.sql", import.meta.url);
const url = databaseUrl();
const sql = readFileSync(schemaPath, "utf8");
const db = createClient({ url });
await db.executeMultiple(sql);
const r = await db.execute(
  "select count(*) as n from sqlite_master where type='table'",
);
console.log(`[bootstrap-db] schema applied (${r.rows[0].n} tables) at ${url}`);
