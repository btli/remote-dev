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
 * The dialect-specific modules are pulled in with STATIC top-level imports so
 * the references are statically linked and survive Next.js standalone bundling.
 * The prior implementation lazily `require()`d these modules, but that interop
 * does NOT survive standalone bundling — the named export resolved to
 * `undefined`, producing `TypeError: PgLogStore is not a constructor` at
 * runtime (bug pcm7). Static imports are bundler-safe.
 *
 * Importing both dialect modules on either path is safe:
 *   - The native drivers (`pg`, `better-sqlite3`) are externalized via
 *     `serverExternalPackages` in next.config, so they are not bundled.
 *   - None of these store modules open a DB connection at import time — the PG
 *     stores only construct an in-memory write buffer and lazily get the pool on
 *     first flush; the SQLite stores lazily open their DB on first use. A
 *     synchronous accessor is required because `AppLogger.write()` is a
 *     synchronous fire-and-forget call, so an `await import()` is not an option.
 *
 * Both stores are process-wide singletons.
 */

import { isPostgres } from "@/db/is-postgres";
import type { LogRepository } from "@/application/ports/LogRepository";
import type { AnalyticsStore } from "@/application/ports/AnalyticsStore";
import { PgLogStore } from "./pg/PgLogStore";
import { PgAnalyticsStore } from "./pg/PgAnalyticsStore";
import { getLogRepositoryInstance } from "./repositories/BetterSqliteLogRepository";
import { SqliteAnalyticsStore } from "@/infrastructure/analytics/SqliteAnalyticsStore";

let _logStore: LogRepository | null = null;
let _analyticsStore: AnalyticsStore | null = null;

export function getLogStore(): LogRepository {
  if (_logStore) return _logStore;

  _logStore = isPostgres() ? new PgLogStore() : getLogRepositoryInstance();
  return _logStore;
}

export function getAnalyticsStore(): AnalyticsStore {
  if (_analyticsStore) return _analyticsStore;

  _analyticsStore = isPostgres()
    ? new PgAnalyticsStore()
    : new SqliteAnalyticsStore();
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
