/**
 * Sidecar store factory.
 *
 * Selects the sidecar (logs + analytics) implementation based on the active
 * backend:
 *   - Postgres (`DATABASE_URL` is postgres): the PG stores, which write through
 *     an async buffer into the `logs` / `analytics` schemas of the main DB.
 *   - SQLite (default): the original synchronous better-sqlite3 stores,
 *     behavior-identical to the prior implementation.
 *
 * The dialect-specific modules are loaded with a lazy `require()` so that `pg`
 * is only pulled in on the Postgres path and `better-sqlite3` only on the
 * SQLite path — neither driver is loaded for the backend not in use. A
 * synchronous accessor is required because `AppLogger.write()` is a synchronous
 * fire-and-forget call, so an `await import()` is not an option here.
 *
 * This mirrors the existing lazy-require convention in this codebase
 * (`src/lib/dynamic-fs.ts`, `src/lib/preferences.ts`), which uses the same
 * single-line `no-require-imports` directive for exactly this purpose.
 *
 * Both stores are process-wide singletons.
 */

import { isPostgres } from "@/db/is-postgres";
import type { LogRepository } from "@/application/ports/LogRepository";
import type { AnalyticsStore } from "@/application/ports/AnalyticsStore";

let _logStore: LogRepository | null = null;
let _analyticsStore: AnalyticsStore | null = null;

export function getLogStore(): LogRepository {
  if (_logStore) return _logStore;

  if (isPostgres()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./pg/PgLogStore") as typeof import("./pg/PgLogStore");
    _logStore = new mod.PgLogStore();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./repositories/BetterSqliteLogRepository") as typeof import("./repositories/BetterSqliteLogRepository");
    _logStore = mod.getLogRepositoryInstance();
  }
  return _logStore;
}

export function getAnalyticsStore(): AnalyticsStore {
  if (_analyticsStore) return _analyticsStore;

  if (isPostgres()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./pg/PgAnalyticsStore") as typeof import("./pg/PgAnalyticsStore");
    _analyticsStore = new mod.PgAnalyticsStore();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/infrastructure/analytics/SqliteAnalyticsStore") as typeof import("@/infrastructure/analytics/SqliteAnalyticsStore");
    _analyticsStore = new mod.SqliteAnalyticsStore();
  }
  return _analyticsStore;
}

/**
 * Flush both sidecar stores' buffered writes (no-op on SQLite). Called during
 * graceful shutdown before the sidecar pool is closed.
 */
export async function flushSidecarStores(): Promise<void> {
  await Promise.all([
    _logStore?.flush() ?? Promise.resolve(),
    _analyticsStore?.flush() ?? Promise.resolve(),
  ]);
}
