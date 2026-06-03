/**
 * SQLite dialect builder (libsql) for the Supervisor database.
 *
 * Mirrors the historical `src/db/index.ts` behavior exactly: resolve the data
 * path (DATABASE_URL > SUPERVISOR_DATA_DIR/supervisor.db > ~/.remote-dev-
 * supervisor/supervisor.db), ensure the directory exists, open a libsql client,
 * apply the WAL/synchronous/busy_timeout PRAGMAs, and wrap it in Drizzle over
 * the SQLite schema.
 *
 * NOTE: busy_timeout is 10000ms (NOT the main app's 5000) — the Next.js API
 * process and the controller process both write, and both may run migrate-on-
 * boot at once on slow PVC-backed storage.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "./schema.sqlite";
import type { AppDb, Dialect } from "./dialect";

function getDataDir(): string {
  return (
    process.env.SUPERVISOR_DATA_DIR || join(homedir(), ".remote-dev-supervisor")
  );
}

function getDatabaseUrl(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    return dbUrl.startsWith("file:") ? dbUrl : `file:${dbUrl}`;
  }
  return `file:${join(getDataDir(), "supervisor.db")}`;
}

export function buildSqliteDialect(): Dialect {
  // Ensure the data directory exists before connecting (no-op when DATABASE_URL
  // points elsewhere and the dir already exists).
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const client = createClient({ url: getDatabaseUrl() });

  // WAL + busy_timeout to avoid SQLITE_BUSY under concurrent writes. 10s (not
  // 5s) gives slow PVC-backed storage headroom when BOTH processes run
  // migrate-on-boot at once.
  client.execute("PRAGMA journal_mode = WAL").catch(() => {});
  client.execute("PRAGMA synchronous = NORMAL").catch(() => {});
  client.execute("PRAGMA busy_timeout = 10000").catch(() => {});

  const db = drizzle(client, { schema: sqliteSchema }) as unknown as AppDb;
  return { db };
}
