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
const dbState: { authorizedLookups: number } = { authorizedLookups: 0 };

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

// DB seam: any consultation in the CF branch is a BUG when the email is missing.
// Throwing turns "drizzle was handed undefined" into a hard test failure, while
// the production guard means these are never reached on the email-less path.
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
      users: { findFirst: async () => undefined },
    },
  },
}));

vi.mock("@/db/schema", () => ({ authorizedUsers: {}, users: {} }));
vi.mock("@/lib/user-identity", () => ({
  getOrCreateUserByEmail: vi.fn(),
  ensurePrimaryUserEmail: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";

beforeEach(() => {
  vi.clearAllMocks();
  cfState.token = null;
  cfState.user = null;
  authState.session = null;
  dbState.authorizedLookups = 0;
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

  it("returns null cleanly when validateAccessJWT itself returns null (no user)", async () => {
    cfState.token = "cf-service-token";
    cfState.user = null;
    authState.session = null;

    await expect(getAuthSession()).resolves.toBeNull();
    expect(dbState.authorizedLookups).toBe(0);
  });
});
