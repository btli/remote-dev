/**
 * SQLite dialect builder (libsql).
 *
 * Mirrors the historical `src/db/index.ts` behavior exactly: ensure data
 * directories exist, open a libsql client at the configured file URL, apply the
 * WAL/synchronous/busy_timeout PRAGMAs, and wrap it in Drizzle over the SQLite
 * schema. The `DialectClient` facade normalizes the libsql result shape.
 */
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "./schema.sqlite";
import { getDatabaseUrl, ensureDataDirectories } from "@/lib/paths";
import type { AppDb, Dialect, DialectExecuteResult } from "./dialect";

export function buildSqliteDialect(): Dialect {
  // Ensure data directories exist before connecting to the database.
  ensureDataDirectories();

  // Priority: DATABASE_URL env var > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
  const rawClient = createClient({ url: getDatabaseUrl() });

  // Enable WAL mode and busy_timeout to prevent SQLITE_BUSY under concurrent writes.
  rawClient.execute("PRAGMA journal_mode = WAL").catch(() => {});
  rawClient.execute("PRAGMA synchronous = NORMAL").catch(() => {});
  rawClient.execute("PRAGMA busy_timeout = 5000").catch(() => {});

  const db = drizzle(rawClient, { schema: sqliteSchema }) as unknown as AppDb;

  async function execute(
    sql: string,
    args: unknown[] = []
  ): Promise<DialectExecuteResult> {
    const r = await rawClient.execute({ sql, args: args as never });
    return {
      rows: r.rows as unknown as Record<string, unknown>[],
      rowsAffected: r.rowsAffected,
    };
  }

  async function runProbe(): Promise<void> {
    await rawClient.execute("SELECT 1");
  }

  const client = { execute, runProbe };
  return { db, client, execute, runProbe };
}
