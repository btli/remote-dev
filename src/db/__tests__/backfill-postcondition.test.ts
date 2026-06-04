// @vitest-environment node
/**
 * Tests for the generalizable deploy-time backfill POST-CONDITION verification
 * (`src/db/backfill-postcondition.ts`, remote-dev-6lf3).
 *
 * The post-condition runs real SQL (a `NOT EXISTS` count) plus a Drizzle
 * `query.users.findMany`, so rather than a hand-rolled fake we back `@/db` with a
 * REAL in-memory libsql database (the same driver prod uses) created here. The
 * tables mirror the live `user` / `user_email` schema closely enough to exercise
 * the exact invariant: every user with an email must have a matching user_email
 * row. This catches the #338 failure mode (table present, rows missing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as sqliteSchema from "@/db/schema.sqlite";

// One in-memory libsql client per test, wired into @/db via the mock below.
let client: Client;

vi.mock("@/db", () => ({
  // Lazily delegate to the per-test client so each test gets a fresh DB.
  get db() {
    return drizzle(client, { schema: sqliteSchema });
  },
  execute: async (sql: string, args: unknown[] = []) => {
    const r = await client.execute({ sql, args: args as never });
    return {
      rows: r.rows as unknown as Record<string, unknown>[],
      rowsAffected: r.rowsAffected,
    };
  },
}));

// Import AFTER the mock is registered.
import {
  checkUserEmailBackfill,
  verifyBackfills,
  BACKFILL_POSTCONDITIONS,
} from "@/db/backfill-postcondition";

async function createSchema(c: Client): Promise<void> {
  // Minimal slice of the live schema needed by the post-condition.
  await c.execute(`
    CREATE TABLE "user" (
      id    TEXT PRIMARY KEY,
      name  TEXT,
      email TEXT UNIQUE,
      emailVerified INTEGER,
      image TEXT
    )
  `);
  await c.execute(`
    CREATE TABLE user_email (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function addUser(c: Client, id: string, email: string | null): Promise<void> {
  await c.execute({
    sql: `INSERT INTO "user" (id, email) VALUES (?, ?)`,
    args: [id, email],
  });
}

async function addUserEmail(
  c: Client,
  id: string,
  userId: string,
  email: string,
): Promise<void> {
  await c.execute({
    sql: `INSERT INTO user_email (id, user_id, email, is_primary, created_at) VALUES (?, ?, ?, 1, 0)`,
    args: [id, userId, email],
  });
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await createSchema(client);
});

afterEach(() => {
  client.close();
});

describe("checkUserEmailBackfill", () => {
  it("passes when every user with an email has a matching user_email row", async () => {
    await addUser(client, "u1", "a@example.com");
    await addUserEmail(client, "ue1", "u1", "a@example.com");
    await addUser(client, "u2", "b@example.com");
    await addUserEmail(client, "ue2", "u2", "b@example.com");

    const result = await checkUserEmailBackfill();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("2 users");
  });

  it("FAILS (the #338 case) when the table exists but a user's row is missing", async () => {
    await addUser(client, "u1", "a@example.com");
    // No user_email row inserted — exactly the empty-table backfill gap.
    const result = await checkUserEmailBackfill();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("MISSING");
    expect(result.detail).toContain("1 of 1");
  });

  it("counts only the users that are actually missing", async () => {
    await addUser(client, "u1", "a@example.com");
    await addUserEmail(client, "ue1", "u1", "a@example.com"); // satisfied
    await addUser(client, "u2", "b@example.com"); // missing
    await addUser(client, "u3", "c@example.com"); // missing

    const result = await checkUserEmailBackfill();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("2 of 3");
  });

  it("ignores users with a NULL email (nothing to resolve)", async () => {
    await addUser(client, "u1", null);
    const result = await checkUserEmailBackfill();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("all 0 users");
  });

  it("does not require the user_email's email to be marked primary, only present+matching", async () => {
    await addUser(client, "u1", "a@example.com");
    // Row present but is_primary = 0 — still satisfies "has a matching row".
    await client.execute({
      sql: `INSERT INTO user_email (id, user_id, email, is_primary, created_at) VALUES (?, ?, ?, 0, 0)`,
      args: ["ue1", "u1", "a@example.com"],
    });
    const result = await checkUserEmailBackfill();
    expect(result.ok).toBe(true);
  });
});

describe("verifyBackfills", () => {
  it("aggregates to ok=true when all registered post-conditions pass", async () => {
    await addUser(client, "u1", "a@example.com");
    await addUserEmail(client, "ue1", "u1", "a@example.com");

    const outcome = await verifyBackfills();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(BACKFILL_POSTCONDITIONS.length);
    expect(outcome.results.every((r) => r.ok)).toBe(true);
  });

  it("aggregates to ok=false when any post-condition fails", async () => {
    await addUser(client, "u1", "a@example.com"); // missing user_email row
    const outcome = await verifyBackfills();
    expect(outcome.ok).toBe(false);
    expect(outcome.results.find((r) => r.name === "db:backfill-user-emails")?.ok).toBe(false);
  });

  it("treats a THROWING check as a failure (e.g. table missing)", async () => {
    const outcome = await verifyBackfills([
      {
        name: "explodes",
        description: "always throws",
        check: async () => {
          throw new Error("boom");
        },
      },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0].detail).toContain("post-condition threw");
    expect(outcome.results[0].detail).toContain("boom");
  });
});
