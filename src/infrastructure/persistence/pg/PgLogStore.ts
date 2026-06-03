/**
 * PgLogStore - Postgres implementation of the LogRepository port.
 *
 * Writes are async-buffered: `write()` enqueues into a PgWriteBuffer and returns
 * immediately (synchronous fire-and-forget). The buffer flushes batches into
 * `logs.log_entry` via a single multi-row INSERT built with `UNNEST` arrays.
 * Logging must never block the request path and must survive Postgres hiccups
 * by dropping, so a failed flush drops the batch (handled inside the buffer).
 *
 * Reads (`query` / `getNamespaces` / `deleteOlderThan`) are async pg queries.
 * `ts` is stored as a BIGINT epoch-ms column, mirroring the SQLite schema.
 */

import type {
  LogRepository,
  LogEntryRecord,
  LogQueryOptions,
  LogSource,
} from "@/application/ports/LogRepository";
import { LEVEL_RANK, type LogLevelValue } from "@/domain/value-objects/LogLevel";
import { getSidecarPool } from "./sidecar-db";
import { PgWriteBuffer } from "./PgWriteBuffer";

/** Escape LIKE special characters so they match literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

type BufferedLog = Omit<LogEntryRecord, "id">;

export class PgLogStore implements LogRepository {
  private readonly buffer: PgWriteBuffer<BufferedLog>;

  constructor() {
    this.buffer = new PgWriteBuffer<BufferedLog>(
      (items) => this.flushBatch(items),
      { name: "logs" }
    );
  }

  write(entry: BufferedLog): void {
    this.buffer.enqueue([entry]);
  }

  /**
   * Persist a drained batch with a single multi-row INSERT using UNNEST arrays.
   * Throws on error so the buffer can drop + report (never blocks the caller).
   */
  private async flushBatch(items: BufferedLog[]): Promise<void> {
    if (items.length === 0) return;

    const ts: number[] = [];
    const level: string[] = [];
    const namespace: string[] = [];
    const message: string[] = [];
    const data: (string | null)[] = [];
    const source: string[] = [];

    for (const e of items) {
      ts.push(e.timestamp);
      level.push(e.level);
      namespace.push(e.namespace);
      message.push(e.message);
      data.push(e.data);
      source.push(e.source);
    }

    await getSidecarPool().query(
      `INSERT INTO logs.log_entry (ts, level, namespace, message, data, source)
       SELECT * FROM UNNEST(
         $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
       )`,
      [ts, level, namespace, message, data, source]
    );
  }

  async query(options: LogQueryOptions = {}): Promise<LogEntryRecord[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    const next = (v: string | number): string => {
      params.push(v);
      return `$${params.length}`;
    };

    if (options.level) {
      const threshold = LEVEL_RANK[options.level];
      const includedLevels = (Object.keys(LEVEL_RANK) as LogLevelValue[]).filter(
        (l) => LEVEL_RANK[l] <= threshold
      );
      const placeholders = includedLevels.map((l) => next(l)).join(", ");
      conditions.push(`level IN (${placeholders})`);
    }
    if (options.namespace) {
      conditions.push(`namespace LIKE ${next(`%${escapeLike(options.namespace)}%`)} ESCAPE '\\'`);
    }
    if (options.source) {
      conditions.push(`source = ${next(options.source)}`);
    }
    if (options.search) {
      conditions.push(`message LIKE ${next(`%${escapeLike(options.search)}%`)} ESCAPE '\\'`);
    }
    if (options.before) {
      conditions.push(`ts < ${next(options.before)}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 200;
    const limitPlaceholder = next(limit);

    const sql = `
      SELECT id, ts AS timestamp, level, namespace, message, data, source
      FROM logs.log_entry
      ${where}
      ORDER BY ts DESC
      LIMIT ${limitPlaceholder}
    `;

    const result = await getSidecarPool().query(sql, params);
    return result.rows.map((row) => ({
      id: Number(row.id),
      timestamp: Number(row.timestamp),
      level: row.level as LogLevelValue,
      namespace: row.namespace as string,
      message: row.message as string,
      data: (row.data as string | null) ?? null,
      source: row.source as LogSource,
    }));
  }

  async getNamespaces(): Promise<string[]> {
    const result = await getSidecarPool().query(
      "SELECT DISTINCT namespace FROM logs.log_entry ORDER BY namespace"
    );
    return result.rows.map((r) => r.namespace as string);
  }

  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const result = await getSidecarPool().query(
      "DELETE FROM logs.log_entry WHERE ts < $1",
      [cutoffMs]
    );
    return result.rowCount ?? 0;
  }

  async flush(): Promise<void> {
    await this.buffer.flush();
  }
}
