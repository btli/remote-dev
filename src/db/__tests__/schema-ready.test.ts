/**
 * Tests for `src/db/schema-ready.ts` (remote-dev-snap).
 *
 * `waitForSchemaReady()` gates the terminal server's DB-touching services on the
 * PostgreSQL schema being migrated, but is a strict NO-OP on SQLite. The most
 * important guarantee is the SQLite no-op: it must resolve immediately WITHOUT
 * importing/opening a `pg` pool (so `pg` never loads on the SQLite cold path).
 *
 * Dialect is read at call time via `isPostgres()` (which reads
 * `process.env.DATABASE_URL`). We stub `DATABASE_URL` and mock the `pg` module
 * so we can both (a) prove the SQLite path never constructs a Pool and (b)
 * exercise the Postgres readiness poll deterministically without a live DB.
 * `vi.resetModules()` between cases gives each a clean registry. Mirrors the
 * env-stubbing pattern in
 * `src/infrastructure/persistence/__tests__/sidecar-factory.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

/** Construct a mocked `pg` module whose Pool.query is scriptable per call. */
function mockPg(queryResults: Array<{ rows?: Array<{ c: number }>; throws?: boolean }>) {
  const query = vi.fn();
  for (const r of queryResults) {
    if (r.throws) {
      query.mockRejectedValueOnce(new Error('relation "drizzle.__drizzle_migrations" does not exist'));
    } else {
      query.mockResolvedValueOnce({ rows: r.rows ?? [] });
    }
  }
  const end = vi.fn().mockResolvedValue(undefined);
  // Return a real instance from `new Pool(...)`: assign the scriptable mocks
  // onto `this` so `query`/`end` are callable on the constructed object.
  const Pool = vi.fn(function (this: { query: typeof query; end: typeof end }) {
    this.query = query;
    this.end = end;
  });
  vi.doMock("pg", () => ({ Pool }));
  return { Pool, query, end };
}

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("pg");
});

describe("waitForSchemaReady", () => {
  it("is a no-op on SQLite and never opens a pg Pool", async () => {
    vi.stubEnv("DATABASE_URL", "");
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { Pool } = mockPg([]);
    const { waitForSchemaReady } = await import("../schema-ready");

    await expect(waitForSchemaReady()).resolves.toBeUndefined();
    expect(Pool).not.toHaveBeenCalled();
  });

  it("returns once applied migrations reach the committed count (Postgres)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/rdv");
    vi.resetModules();

    // First poll: table missing (relation does not exist). Second poll: all
    // 7 committed migrations applied → ready.
    const { Pool, end } = mockPg([
      { throws: true },
      { rows: [{ c: 7 }] },
    ]);
    const { waitForSchemaReady } = await import("../schema-ready");

    await expect(waitForSchemaReady({ timeoutMs: 5_000 })).resolves.toBeUndefined();
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("fails open after the timeout without throwing (Postgres)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/rdv");
    vi.resetModules();

    // Always report 0 applied migrations so readiness is never reached; the
    // short timeout forces the fail-open path. Provide plenty of throwing
    // responses so the poll loop never runs out of scripted results.
    const { Pool, end } = mockPg(Array.from({ length: 50 }, () => ({ rows: [{ c: 0 }] })));
    const { waitForSchemaReady } = await import("../schema-ready");

    await expect(waitForSchemaReady({ timeoutMs: 250 })).resolves.toBeUndefined();
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
