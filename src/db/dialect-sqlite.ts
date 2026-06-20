/**
 * SQLite dialect builder (libsql).
 *
 * Ensures data directories exist, opens a libsql client at the configured file
 * URL, applies the WAL/synchronous/busy_timeout PRAGMAs, and wraps it in
 * Drizzle over the SQLite schema. The raw libsql client is wrapped in a
 * busy-resilient proxy so every non-interactive ORM query (`execute`/`batch`)
 * transparently retries SQLITE_BUSY. The `DialectClient` facade normalizes the
 * libsql result shape.
 */
import { createClient } from "@libsql/client/node";
import type { Client, InStatement, InArgs, ResultSet } from "@libsql/core/api";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "./schema.sqlite";
import { getDatabaseUrl, ensureDataDirectories } from "@/lib/paths";
import type {
  AppDb,
  Dialect,
  DialectExecuteResult,
  WalCheckpointResult,
} from "./dialect";
import { withBusyRetry } from "./busy-retry";
import { createLogger } from "@/lib/logger";

const log = createLogger("DB");

/**
 * Wrap a libsql {@link Client} so `execute` and `batch` retry SQLITE_BUSY, and
 * so the WAL/synchronous/busy_timeout PRAGMAs are applied (awaited) before the
 * first query runs. All other members (`transaction`, `sync`, `close`,
 * `closed`, `protocol`, …) pass through unchanged.
 *
 * `buildSqliteDialect()` stays synchronous (no top-level await — `getDialect()`
 * calls it inline), so PRAGMA ordering is enforced lazily: the first
 * `execute`/`batch` awaits a one-time init promise before delegating. A single
 * statement / atomic batch that returns SQLITE_BUSY did NOT apply, so retrying
 * is safe.
 *
 * KNOWN GAP: interactive `transaction()` is passed through WITHOUT retry — a
 * busy error mid-transaction can leave partial work, so a blind retry there
 * would not be safe. This is a smaller surface (the ORM uses non-interactive
 * batches for its writes).
 */
function wrapBusyResilient(rawClient: Client): Client {
  // One-time PRAGMA initialization. Awaited by the first execute/batch so the
  // PRAGMAs are guaranteed applied before any real query touches the db.
  let pragmaInit: Promise<void> | null = null;
  function ensurePragmas(): Promise<void> {
    if (!pragmaInit) {
      pragmaInit = (async () => {
        // Order matters: journal_mode + synchronous first, then busy_timeout.
        await rawClient.execute("PRAGMA journal_mode = WAL");
        await rawClient.execute("PRAGMA synchronous = NORMAL");
        await rawClient.execute("PRAGMA busy_timeout = 15000");
      })().catch((error) => {
        // Don't permanently poison the gate on a transient failure; log and
        // allow a later query to retry initialization.
        //
        // Trade-off on a missed apply: the very next query proceeds against the
        // default `busy_timeout = 0` (no in-engine wait) — still backstopped by
        // `withBusyRetry`, which retries SQLITE_BUSY in app code — and it
        // re-attempts this init (we cleared `pragmaInit`), so the timeout is
        // typically restored on the following query. `journal_mode = WAL` is a
        // PERSISTENT property of the db file, not a per-connection setting, so a
        // missed apply here does NOT silently disable WAL/checkpointing: the
        // file stays in whatever journal mode it already had, and a later retry
        // re-applies WAL if needed.
        pragmaInit = null;
        log.warn("Failed to apply SQLite PRAGMAs", { error: String(error) });
      });
    }
    return pragmaInit ?? Promise.resolve();
  }

  return new Proxy(rawClient, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        // Preserve both overloads: execute(stmt) and execute(sql, args).
        const execute = ((
          stmtOrSql: InStatement | string,
          args?: InArgs
        ): Promise<ResultSet> =>
          withBusyRetry(
            async () => {
              await ensurePragmas();
              return args === undefined
                ? target.execute(stmtOrSql as InStatement)
                : target.execute(stmtOrSql as string, args);
            },
            { label: "execute" }
          )) as Client["execute"];
        return execute;
      }
      if (prop === "batch") {
        const batch: Client["batch"] = (stmts, mode) =>
          withBusyRetry(
            async () => {
              await ensurePragmas();
              return target.batch(stmts, mode);
            },
            { label: "batch" }
          );
        return batch;
      }
      // Pass everything else through, preserving `this` binding for methods.
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function buildSqliteDialect(): Dialect {
  // Ensure data directories exist before connecting to the database.
  ensureDataDirectories();

  // Priority: DATABASE_URL env var > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
  const rawClient = createClient({ url: getDatabaseUrl() });

  // Busy-resilient wrapper: applies WAL/synchronous/busy_timeout PRAGMAs (awaited
  // before first use) and retries SQLITE_BUSY on every non-interactive query.
  const client = wrapBusyResilient(rawClient);

  const db = drizzle(client, { schema: sqliteSchema }) as unknown as AppDb;

  async function execute(
    sql: string,
    args: unknown[] = []
  ): Promise<DialectExecuteResult> {
    const r = await client.execute({ sql, args: args as never });
    return {
      rows: r.rows as unknown as Record<string, unknown>[],
      rowsAffected: r.rowsAffected,
    };
  }

  async function runProbe(): Promise<void> {
    await client.execute("SELECT 1");
  }

  /**
   * Flush and TRUNCATE the WAL so it cannot grow unbounded (a 2.1 GB WAL once
   * amplified write contention into SQLITE_BUSY). Returns the libsql
   * `(busy, log, checkpointed)` row. Logs at debug; warns when `busy` is
   * non-zero (a reader/writer blocked a full checkpoint).
   */
  async function checkpointWal(): Promise<WalCheckpointResult> {
    const r = await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = (r.rows[0] ?? {}) as Record<string, unknown>;
    const result: WalCheckpointResult = {
      busy: Number(row.busy ?? 0),
      log: Number(row.log ?? 0),
      checkpointed: Number(row.checkpointed ?? 0),
    };
    const logData = {
      busy: result.busy,
      log: result.log,
      checkpointed: result.checkpointed,
    };
    if (result.busy !== 0) {
      log.warn("WAL checkpoint could not fully complete (busy)", logData);
    } else {
      log.debug("WAL checkpoint complete", logData);
    }
    return result;
  }

  const facade = { execute, runProbe };
  return { db, client: facade, execute, runProbe, checkpointWal };
}
