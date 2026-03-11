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
   */
  write(entry: Omit<LogEntryRecord, "id">): void;

  /**
   * Query log entries with optional filters.
   * Returns entries ordered by timestamp descending (newest first).
   */
  query(options: LogQueryOptions): LogEntryRecord[];

  /**
   * Get distinct namespaces from the log database.
   */
  getNamespaces(): string[];

  /**
   * Delete log entries older than the given cutoff timestamp.
   * Returns the number of deleted entries.
   */
  deleteOlderThan(cutoffMs: number): number;
}
