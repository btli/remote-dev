/**
 * LogDatabase - Singleton connection to the separate logs SQLite database.
 *
 * Uses better-sqlite3 for synchronous writes (ideal for logging — no dropped entries).
 * The logs database is stored at ~/.remote-dev/logs/logs.db, separate from the
 * main application database to avoid polluting it with high-volume log data.
 *
 * WAL mode enables safe concurrent writes from both the Next.js and terminal server processes.
 */

import Database from "better-sqlite3";
import { getLogsDatabasePath, getLogsDir } from "@/lib/paths";
import { mkdirSync } from "fs";

let _db: Database.Database | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS log_entry (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    level     TEXT    NOT NULL,
    namespace TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    data      TEXT,
    source    TEXT    NOT NULL DEFAULT 'nextjs'
  );
  CREATE INDEX IF NOT EXISTS idx_log_ts        ON log_entry(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_log_level     ON log_entry(level);
  CREATE INDEX IF NOT EXISTS idx_log_namespace ON log_entry(namespace);
`;

export function getLogDatabase(): Database.Database {
  if (_db) return _db;

  mkdirSync(getLogsDir(), { recursive: true });

  _db = new Database(getLogsDatabasePath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(SCHEMA_SQL);

  return _db;
}

/**
 * Close the log database connection.
 * Called during graceful shutdown.
 */
export function closeLogDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
