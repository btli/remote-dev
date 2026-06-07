/**
 * Tests for the CF-Access branch guard in `getAuthSession` (src/lib/auth-utils.ts).
 *
 * Regression: remote-dev-2w1o. A Cloudflare Access SERVICE token clears the edge
 * and yields a verified-but-email-less CF user. `validateAccessJWT` now returns
 * null for those, but `getAuthSession` ALSO guards defensively: it must only run
 * the `authorizedUsers` / `getOrCreateUserByEmail` DB lookups when `cfUser.email`
 * is a non-empty string. If the validator ever hands back an email-less user
 * (bug / future regression), `getAuthSession` must NOT pass `undefined` to
 * drizzle (which throws → 500) — it must fall through to NextAuth instead.
 *
 * The DB mock's `findFirst` throws if called, so "fell through cleanly" is proven
 * by `getAuthSession` resolving (here: null) WITHOUT throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared mutable state. Read ONLY at call time (never at factory-definition
// time), so it is safe under vi.mock hoisting. `authorizedLookups` counts how
// many times the CF-branch DB authorization lookup ran — it must stay 0 on the
// email-less path (the guard short-circuits before any drizzle call).
const cfState: { token: string | null; user: unknown } = { token: null, user: null };
const authState: { session: unknown } = { session: null };
// `usersFindFirst` lets a test inject the DB-backed user the NextAuth branch
// resolves by JWT id; `authorizedLookups` counts CF-branch authorization lookups
// (must stay 0 on the email-less path — the guard short-circuits before drizzle).
const dbState: {
  authorizedLookups: number;
  usersFindFirst: { id: string; email: string; name: string | null } | undefined;
} = { authorizedLookups: 0, usersFindFirst: undefined };

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "cf-access-jwt-assertion" ? cfState.token : null,
  }),
}));

vi.mock("@/lib/cloudflare-access", () => ({
  validateAccessJWT: vi.fn(async () => cfState.user),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => authState.session),
}));

// DB seam:
//   - authorizedUsers.findFirst THROWS — any CF-branch consultation when the
//     email is missing is a BUG; throwing turns "drizzle was handed undefined"
//     into a hard test failure. It is never reached on the email-less path.
//   - users.findFirst returns the injected NextAuth-branch user (resolve-by-id),
//     so a test can prove the fall-through actually returns a DB-backed session.
vi.mock("@/db", () => ({
  db: {
    query: {
      authorizedUsers: {
        findFirst: async () => {
          dbState.authorizedLookups += 1;
          throw new Error(
            "authorizedUsers.findFirst should not be called for an email-less CF user",
          );
        },
      },
      users: { findFirst: async () => dbState.usersFindFirst },
    },
  },
}));

vi.mock("@/db/schema", () => ({ authorizedUsers: {}, users: {} }));
vi.mock("@/lib/user-identity", () => ({
  getOrCreateUserByEmail: vi.fn(),
  ensurePrimaryUserEmail: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import { auth } from "@/auth";

beforeEach(() => {
  vi.clearAllMocks();
  cfState.token = null;
  cfState.user = null;
  authState.session = null;
  dbState.authorizedLookups = 0;
  dbState.usersFindFirst = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAuthSession — CF service-token (email-less) fall-through", () => {
  it("(c) does not throw and falls through when the CF validator yields an email-less user", async () => {
    // A CF token is present and the validator returns a user object WITHOUT an
    // email (models a non-identity token slipping past the validator guard).
    cfState.token = "cf-service-token";
    cfState.user = { email: undefined, sub: "service-sub" };
    authState.session = null; // no NextAuth session either → overall null

    await expect(getAuthSession()).resolves.toBeNull();
    // The DB authorization lookup must never have been consulted with no email.
    expect(dbState.authorizedLookups).toBe(0);
  });

  it("(c) falls through to the NextAuth session when CF yields an empty-string email", async () => {
    cfState.token = "cf-service-token";
    cfState.user = { email: "", sub: "service-sub" };
    authState.session = null;

    await expect(getAuthSession()).resolves.toBeNull();
    expect(dbState.authorizedLookups).toBe(0);
  });

  it("(c) RETURNS the DB-backed NextAuth session when CF is a service token but a real session exists", async () => {
    // A CF service token is present (email-less → CF branch skipped), AND the
    // user is also signed in via NextAuth. The proxy let this request through
    // (Bearer/session path); getAuthSession must IGNORE the CF service token,
    // CONSULT auth(), and return the DB-backed session — not null.
    cfState.token = "cf-service-token";
    cfState.user = { email: undefined, sub: "service-sub" };
    authState.session = { user: { id: "user-1", email: "real@example.com", name: "Real" } };
    // The NextAuth branch resolves the user by JWT id from the DB.
    dbState.usersFindFirst = { id: "user-1", email: "real@example.com", name: "Real" };

    const result = await getAuthSession();

    expect(result).toEqual({
      user: { id: "user-1", email: "real@example.com", name: "Real" },
    });
    // The fall-through genuinely consulted NextAuth (the CF branch did not satisfy it).
    expect(vi.mocked(auth)).toHaveBeenCalledTimes(1);
    // And it never touched the CF-branch authorization lookup with an empty email.
    expect(dbState.authorizedLookups).toBe(0);
  });

  it("returns null cleanly when validateAccessJWT itself returns null (no user)", async () => {
    cfState.token = "cf-service-token";
    cfState.user = null;
    authState.session = null;

    await expect(getAuthSession()).resolves.toBeNull();
    expect(dbState.authorizedLookups).toBe(0);
  });
});
