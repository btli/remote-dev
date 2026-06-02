import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The closed-allowlist `signIn` gate (THE security rule): an OIDC-authenticated
 * email is allowed in ONLY if it already exists as a `supervisor_user` OR equals
 * SUPERVISOR_ADMIN_EMAIL. Unknown emails the IdP authenticates are rejected.
 *
 * We test the extracted `isOidcSignInAllowed` (the NextAuth `signIn` callback
 * delegates to it). The DB is mocked so `findFirst` models the allowlist.
 */

type UserRow = { id: string; email: string; role: string };

const dbState: { known: UserRow | undefined } = { known: undefined };

vi.mock("@/db", () => ({
  db: {
    query: {
      supervisorUser: {
        findFirst: async () => dbState.known,
      },
    },
  },
}));

// `@/auth` calls `NextAuth({...})` at import. Under vitest's node resolution the
// real next-auth fails to resolve `next/server` (it uses an extensionless
// import), so stub next-auth + the Drizzle adapter. We only exercise the
// extracted `isOidcSignInAllowed` (pure logic over the mocked db), so the stub
// `NextAuth` just needs to return the destructured shape.
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: { GET: () => {}, POST: () => {} },
    auth: async () => null,
    signIn: async () => {},
    signOut: async () => {},
  }),
}));
vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: () => ({}),
}));

// Importing @/auth instantiates the (stubbed) NextAuth; `isOidcSignInAllowed`
// runs the real allowlist logic against the mocked db.
import { isOidcSignInAllowed } from "@/auth";

beforeEach(() => {
  dbState.known = undefined;
  delete process.env.SUPERVISOR_ADMIN_EMAIL;
});

describe("isOidcSignInAllowed — closed allowlist", () => {
  it("allows a known supervisor_user email", async () => {
    dbState.known = { id: "u1", email: "known@example.com", role: "viewer" };
    expect(await isOidcSignInAllowed("known@example.com")).toBe(true);
  });

  it("allows the configured admin email even if no row exists yet", async () => {
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
    dbState.known = undefined; // not yet in the table
    expect(await isOidcSignInAllowed("boss@example.com")).toBe(true);
  });

  it("REJECTS an unknown email the IdP authenticated", async () => {
    process.env.SUPERVISOR_ADMIN_EMAIL = "boss@example.com";
    dbState.known = undefined;
    expect(await isOidcSignInAllowed("stranger@evil.com")).toBe(false);
  });

  it("REJECTS a missing email", async () => {
    expect(await isOidcSignInAllowed(null)).toBe(false);
    expect(await isOidcSignInAllowed(undefined)).toBe(false);
    expect(await isOidcSignInAllowed("")).toBe(false);
  });
});
