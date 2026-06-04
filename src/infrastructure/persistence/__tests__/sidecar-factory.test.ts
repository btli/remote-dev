/**
 * Tests for `src/infrastructure/persistence/sidecar-factory.ts`.
 *
 * The factory selects the sidecar (logs + analytics) store implementation by
 * dialect: Postgres stores when `DATABASE_URL` is a postgres URL, the
 * better-sqlite3 stores otherwise. Dialect is read at call time via
 * `isPostgres()` (which reads `process.env.DATABASE_URL`), and the factory
 * memoizes the chosen store in module-level singletons. To exercise both paths
 * we stub `DATABASE_URL` and re-import the factory with a fresh module registry
 * (`vi.resetModules()`) between cases so the singleton cache does not leak.
 *
 * Regression guard for bug pcm7: the prior implementation loaded the
 * dialect-specific modules with a lazy `require()`, whose interop did NOT
 * survive Next.js standalone bundling — the named export resolved to undefined,
 * yielding `TypeError: PgLogStore is not a constructor`. The factory now uses
 * static top-level imports. This test asserts each path constructs the correct
 * store class. Constructing the PG stores must NOT touch a live DB (they only
 * build an in-memory write buffer and lazily get the pool on flush), so these
 * cases run without any Postgres available.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

type SidecarFactoryModule = typeof import("../sidecar-factory");

/** Re-import the factory with a clean module registry bound to the current env. */
async function loadFactory(): Promise<SidecarFactoryModule> {
  vi.resetModules();
  return import("../sidecar-factory");
}

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
  vi.unstubAllEnvs();
});

describe("sidecar-factory", () => {
  it("returns the Postgres stores when DATABASE_URL targets Postgres", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/rdv");

    const factory = await loadFactory();
    const { PgLogStore } = await import("../pg/PgLogStore");
    const { PgAnalyticsStore } = await import("../pg/PgAnalyticsStore");

    const logStore = factory.getLogStore();
    const analyticsStore = factory.getAnalyticsStore();

    expect(logStore).toBeInstanceOf(PgLogStore);
    expect(analyticsStore).toBeInstanceOf(PgAnalyticsStore);
    // The named exports must be real constructors (the bug had them undefined).
    expect(logStore.constructor.name).toBe("PgLogStore");
    expect(analyticsStore.constructor.name).toBe("PgAnalyticsStore");
  });

  it("returns the SQLite stores when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    delete process.env.DATABASE_URL;

    const factory = await loadFactory();

    const logStore = factory.getLogStore();
    const analyticsStore = factory.getAnalyticsStore();

    expect(logStore.constructor.name).toBe("BetterSqliteLogRepository");
    expect(analyticsStore.constructor.name).toBe("SqliteAnalyticsStore");
  });

  it("memoizes each store as a process-wide singleton", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/rdv");

    const factory = await loadFactory();

    expect(factory.getLogStore()).toBe(factory.getLogStore());
    expect(factory.getAnalyticsStore()).toBe(factory.getAnalyticsStore());
  });
});
