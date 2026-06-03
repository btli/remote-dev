/**
 * NextAuth (@auth/drizzle-adapter) on PostgreSQL (Unit 11 B/C).
 *
 * Builds the official Drizzle adapter against a node-postgres Drizzle handle
 * bound to schema.pg's user/account/session/verificationToken tables and
 * exercises the core adapter round-trips:
 *   - createUser + getUser
 *   - createSession + getSessionAndUser
 *   - createVerificationToken + useVerificationToken
 *
 * The adapter detects the PostgreSQL dialect via `is(db, PgDatabase)`, so we
 * pass the raw NodePgDatabase (NOT the AppDb-cast handle) to route to
 * PostgresDrizzleAdapter. This proves NextAuth works on Postgres for the
 * dual-backend feature.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterUser } from "@auth/core/adapters";
import { getTestDb, type TestDb } from "./get-test-db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema.pg";

describe("NextAuth DrizzleAdapter on PostgreSQL", () => {
  let tdb: TestDb;
  let adapter: Adapter;

  beforeAll(async () => {
    tdb = await getTestDb("auth");
    adapter = DrizzleAdapter(tdb.db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    });
  });

  afterAll(async () => {
    await tdb?.cleanup();
  });

  it("createUser + getUser round-trips", async () => {
    const id = crypto.randomUUID();
    const email = `${id}@example.com`;
    const emailVerified = new Date();
    const created = await adapter.createUser!({
      id,
      email,
      emailVerified,
      name: "Auth User",
    } as AdapterUser);
    expect(created.id).toBeTruthy();
    expect(created.email).toBe(email);

    const fetched = await adapter.getUser!(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe(email);
    expect(fetched!.name).toBe("Auth User");
    expect(fetched!.emailVerified).toBeInstanceOf(Date);
  });

  it("createSession + getSessionAndUser round-trips", async () => {
    const id = crypto.randomUUID();
    const email = `${id}@example.com`;
    const user = await adapter.createUser!({
      id,
      email,
      emailVerified: null,
      name: "Session Owner",
    } as AdapterUser);

    const sessionToken = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await adapter.createSession!({
      sessionToken,
      userId: user.id,
      expires,
    });
    expect(session.sessionToken).toBe(sessionToken);

    const result = await adapter.getSessionAndUser!(sessionToken);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(user.id);
    expect(result!.session.sessionToken).toBe(sessionToken);
    expect(result!.session.userId).toBe(user.id);
    expect(result!.session.expires).toBeInstanceOf(Date);
    expect(Math.abs(result!.session.expires.getTime() - expires.getTime())).toBeLessThanOrEqual(1000);
  });

  it("createVerificationToken + useVerificationToken round-trips", async () => {
    const identifier = `verify-${crypto.randomUUID()}@example.com`;
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    const created = await adapter.createVerificationToken!({ identifier, token, expires });
    expect(created?.identifier).toBe(identifier);
    expect(created?.token).toBe(token);

    // First use consumes (returns) the token.
    const used = await adapter.useVerificationToken!({ identifier, token });
    expect(used).not.toBeNull();
    expect(used!.identifier).toBe(identifier);
    expect(used!.token).toBe(token);
    expect(used!.expires).toBeInstanceOf(Date);

    // Second use returns null (already consumed).
    const again = await adapter.useVerificationToken!({ identifier, token });
    expect(again).toBeNull();
  });
});
