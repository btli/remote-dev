/**
 * BetterSqliteLogRepository - Log repository implementation using better-sqlite3.
 *
 * Synchronous writes via better-sqlite3 ensure no log entries are lost.
 * The separate logs.db file prevents log volume from impacting the main application DB.
 */

import type {
  LogRepository,
  LogEntryRecord,
  LogQueryOptions,
} from "@/application/ports/LogRepository";
import { getLogDatabase } from "@/infrastructure/logging/LogDatabase";
import { LEVEL_RANK, type LogLevelValue } from "@/domain/value-objects/LogLevel";
import type Database from "better-sqlite3";

/** Escape LIKE special characters so they match literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export class BetterSqliteLogRepository implements LogRepository {
  private insertStmt: Database.Statement | null = null;

  private getInsertStmt(): Database.Statement {
    if (!this.insertStmt) {
      this.insertStmt = getLogDatabase().prepare(
        "INSERT INTO log_entry (ts, level, namespace, message, data, source) VALUES (?, ?, ?, ?, ?, ?)"
      );
    }
    return this.insertStmt;
  }

  write(entry: Omit<LogEntryRecord, "id">): void {
    this.getInsertStmt().run(
      entry.timestamp,
      entry.level,
      entry.namespace,
      entry.message,
      entry.data,
      entry.source
    );
  }

  query(options: LogQueryOptions = {}): LogEntryRecord[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.level) {
      const threshold = LEVEL_RANK[options.level];
      const includedLevels = (Object.keys(LEVEL_RANK) as LogLevelValue[]).filter(
        (l) => LEVEL_RANK[l] <= threshold
      );
      const placeholders = includedLevels.map(() => "?").join(", ");
      conditions.push(`level IN (${placeholders})`);
      params.push(...includedLevels);
    }
    if (options.namespace) {
      conditions.push("namespace LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(options.namespace)}%`);
    }
    if (options.source) {
      conditions.push("source = ?");
      params.push(options.source);
    }
    if (options.search) {
      conditions.push("message LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(options.search)}%`);
    }
    if (options.before) {
      conditions.push("ts < ?");
      params.push(options.before);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 200;

    const sql = `SELECT id, ts as timestamp, level, namespace, message, data, source FROM log_entry ${where} ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    return getLogDatabase().prepare(sql).all(...params) as LogEntryRecord[];
  }

  getNamespaces(): string[] {
    const rows = getLogDatabase()
      .prepare("SELECT DISTINCT namespace FROM log_entry ORDER BY namespace")
      .all() as Array<{ namespace: string }>;
    return rows.map((r) => r.namespace);
  }

  deleteOlderThan(cutoffMs: number): number {
    const result = getLogDatabase()
      .prepare("DELETE FROM log_entry WHERE ts < ?")
      .run(cutoffMs);
    return result.changes;
  }
}

/** Shared singleton instance — used by both AppLogger and the DI container. */
let _instance: BetterSqliteLogRepository | null = null;
export function getLogRepositoryInstance(): BetterSqliteLogRepository {
  if (!_instance) _instance = new BetterSqliteLogRepository();
  return _instance;
}
