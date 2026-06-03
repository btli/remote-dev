/**
 * LogRepository - Port interface for persisting and querying application logs.
 *
 * The logs are stored in a separate SQLite database from the main application DB.
 */

import type { LogLevelValue } from "@/domain/value-objects/LogLevel";

export type LogSource = "nextjs" | "terminal";

export interface LogEntryRecord {
  id: number;
  timestamp: number; // Unix ms
  level: LogLevelValue;
  namespace: string;
  message: string;
  data: string | null; // JSON string
  source: LogSource;
}

export interface LogQueryOptions {
  level?: LogLevelValue;
  namespace?: string;
  source?: LogSource;
  search?: string;
  before?: number; // Unix ms cursor for pagination
  limit?: number;
}

export interface LogRepository {
  /**
   * Write a single log entry to the database.
   *
   * This is a synchronous fire-and-forget contract: it MUST NOT block the
   * caller and MUST NOT throw. The SQLite implementation writes inline; the
   * Postgres implementation enqueues into an async write buffer that flushes
   * in the background (dropping under back-pressure rather than blocking).
   */
  write(entry: Omit<LogEntryRecord, "id">): void;

  /**
   * Query log entries with optional filters.
   * Returns entries ordered by timestamp descending (newest first).
   */
  query(options: LogQueryOptions): Promise<LogEntryRecord[]>;

  /**
   * Get distinct namespaces from the log database.
   */
  getNamespaces(): Promise<string[]>;

  /**
   * Delete log entries older than the given cutoff timestamp.
   * Returns the number of deleted entries.
   */
  deleteOlderThan(cutoffMs: number): Promise<number>;

  /**
   * Flush any buffered writes to durable storage. On SQLite this is a no-op
   * (writes are synchronous); on Postgres it drains the async write buffer.
   * Called during graceful shutdown.
   */
  flush(): Promise<void>;
}
