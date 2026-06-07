// @vitest-environment node
/**
 * Tests for `src/db/boot-seed.ts` (remote-dev-sb98).
 *
 * `seedAuthorizedUsersFromEnv()` seeds `authorized_users` from the
 * `AUTHORIZED_USERS` env at instance boot (the replacement for the never-
 * dispatched supervisor seed Job). The load-bearing guarantees are:
 *   - NO-OP (and no DB call at all) when AUTHORIZED_USERS is unset/empty.
 *   - When set, ONE insert of the parsed emails via onConflictDoNothing (idempotent).
 *   - Parsing matches src/db/seed.ts (comma-split, trim, drop empties) + dedups.
 *   - A DB failure is NON-FATAL: it WARNs and does NOT throw (an already-seeded
 *     instance must still boot).
 *   - INFO logs only a COUNT (never the emails — PII); the emails appear only at DEBUG.
 *
 * We mock `@/db` (capturing the insert chain), `@/db/schema` (the table token),
 * and `@/lib/logger` (to assert on log levels), so the real parse + control flow
 * runs against an in-memory seam without a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted capture seams (vitest hoists vi.mock factories above imports) ---
const seam = vi.hoisted(() => {
  return {
    // The values passed to the last insert().values(...) call, or null if none.
    insertedValues: null as Array<{ email: string }> | null,
    // Whether onConflictDoNothing() was invoked on the insert chain.
    onConflictCalled: false,
    // How many times insert() was called (0 proves the no-op path never touches the DB).
    insertCalls: 0,
    // When set, the insert chain's terminal await rejects with this error.
    throwOnInsert: null as Error | null,
    logs: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    },
  };
});

vi.mock("@/db", () => ({
  db: {
    insert: (_table: unknown) => {
      seam.insertCalls += 1;
      return {
        values: (values: Array<{ email: string }>) => {
          seam.insertedValues = values;
          // The drizzle insert builder is thenable; onConflictDoNothing() returns
          // the same awaitable. Model both so `await db.insert().values()` and
          // `.onConflictDoNothing()` work and can be scripted to reject.
          const result = {
            onConflictDoNothing: () => {
              seam.onConflictCalled = true;
              return result;
            },
            then: (
              resolve: (v: unknown) => unknown,
              reject: (e: unknown) => unknown,
            ) =>
              seam.throwOnInsert
                ? Promise.reject(seam.throwOnInsert).then(resolve, reject)
                : Promise.resolve([]).then(resolve, reject),
          };
          return result;
        },
      };
    },
  },
}));

vi.mock("@/db/schema", () => ({
  authorizedUsers: { __table: "authorized_users" },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => seam.logs,
}));

import { seedAuthorizedUsersFromEnv } from "@/db/boot-seed";

const ORIGINAL = process.env.AUTHORIZED_USERS;

beforeEach(() => {
  seam.insertedValues = null;
  seam.onConflictCalled = false;
  seam.insertCalls = 0;
  seam.throwOnInsert = null;
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTHORIZED_USERS;
  else process.env.AUTHORIZED_USERS = ORIGINAL;
});

describe("seedAuthorizedUsersFromEnv", () => {
  it("is a no-op (no DB call) when AUTHORIZED_USERS is unset", async () => {
    delete process.env.AUTHORIZED_USERS;
    await seedAuthorizedUsersFromEnv();
    expect(seam.insertCalls).toBe(0);
    expect(seam.insertedValues).toBeNull();
    expect(seam.logs.info).not.toHaveBeenCalled();
  });

  it("is a no-op when AUTHORIZED_USERS is empty / whitespace / only commas", async () => {
    for (const value of ["", "   ", ",", " , , "]) {
      seam.insertCalls = 0;
      process.env.AUTHORIZED_USERS = value;
      await seedAuthorizedUsersFromEnv();
      expect(seam.insertCalls).toBe(0);
    }
  });

  it("inserts the parsed emails via onConflictDoNothing when set", async () => {
    process.env.AUTHORIZED_USERS = "a@example.com,b@example.com";
    await seedAuthorizedUsersFromEnv();
    expect(seam.insertCalls).toBe(1);
    expect(seam.insertedValues).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);
    expect(seam.onConflictCalled).toBe(true);
  });

  it("trims whitespace, drops empties, and dedups (same semantics as seed.ts)", async () => {
    process.env.AUTHORIZED_USERS = " a@example.com , , b@example.com ,a@example.com";
    await seedAuthorizedUsersFromEnv();
    expect(seam.insertedValues).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);
  });

  it("logs a COUNT at info (never the emails) and the emails only at debug", async () => {
    process.env.AUTHORIZED_USERS = "secret-user@example.com,other@example.com";
    await seedAuthorizedUsersFromEnv();

    expect(seam.logs.info).toHaveBeenCalledOnce();
    const [, infoMeta] = seam.logs.info.mock.calls[0];
    expect(infoMeta).toEqual({ count: 2 });
    // The emails must NOT appear anywhere in the info call.
    expect(JSON.stringify(seam.logs.info.mock.calls[0])).not.toContain("secret-user@example.com");

    // Debug MAY include the emails (operator detail).
    const [, debugMeta] = seam.logs.debug.mock.calls[0];
    expect(debugMeta).toEqual({ emails: ["secret-user@example.com", "other@example.com"] });
  });

  it("is NON-FATAL on a DB error: warns and does not throw", async () => {
    process.env.AUTHORIZED_USERS = "a@example.com";
    seam.throwOnInsert = new Error("db is down");

    await expect(seedAuthorizedUsersFromEnv()).resolves.toBeUndefined();

    expect(seam.logs.warn).toHaveBeenCalledOnce();
    const [, warnMeta] = seam.logs.warn.mock.calls[0];
    expect(warnMeta).toMatchObject({ error: "Error: db is down", count: 1 });
    // No success info line when the insert failed.
    expect(seam.logs.info).not.toHaveBeenCalled();
  });
});
