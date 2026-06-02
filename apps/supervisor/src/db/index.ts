import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Supervisor SQLite client. Independent of any instance database.
 *
 * Path resolution (mirrors the root app's src/db + src/lib/paths.ts):
 *   DATABASE_URL > SUPERVISOR_DATA_DIR/supervisor.db > ~/.remote-dev-supervisor/supervisor.db
 */
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

// Ensure the data directory exists before connecting (no-op when DATABASE_URL
// points elsewhere and the dir already exists).
const dataDir = getDataDir();
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

export const client = createClient({ url: getDatabaseUrl() });

// WAL + busy_timeout to avoid SQLITE_BUSY under concurrent writes (the Next.js
// API process and the controller process both write). 10s (not 5s) gives slow
// PVC-backed storage headroom when BOTH processes run migrate-on-boot at once.
client.execute("PRAGMA journal_mode = WAL").catch(() => {});
client.execute("PRAGMA synchronous = NORMAL").catch(() => {});
client.execute("PRAGMA busy_timeout = 10000").catch(() => {});

export const db = drizzle(client, { schema });
