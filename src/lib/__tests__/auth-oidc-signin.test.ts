/**
 * Tests for the generic OIDC provider wiring in `src/auth.ts`:
 *
 *   1. The `signIn` callback default-denies an `oidc` sign-in whose email is
 *      NOT in `authorizedUsers`, and allows one that is (the same allowlist
 *      gate GitHub uses).
 *   2. The OIDC provider is present in `providers` only when
 *      `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` are all set.
 *
 * `src/auth.ts` builds its config and passes it to `NextAuth(config)` at
 * module-evaluation time, and the `signIn` callback / OIDC provider object are
 * not otherwise exported. So we mock `next-auth`'s default export to *capture*
 * the config it receives, then dynamic-import `@/auth` (after stubbing env) and
 * assert against the captured config. The DB layer is mocked so the allowlist
 * lookup is controllable without a database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";

// --- Capture the config handed to NextAuth() ------------------------------
let capturedConfig: NextAuthConfig | undefined;

vi.mock("next-auth", () => ({
  default: (config: NextAuthConfig) => {
    capturedConfig = config;
    return { handlers: {}, auth: () => null, signIn: vi.fn(), signOut: vi.fn() };
  },
}));

// Provider factory mocks return identifiable stubs so we can distinguish them
// from the inline OIDC provider object (which `auth.ts` constructs directly).
vi.mock("next-auth/providers/credentials", () => ({
  default: (cfg: Record<string, unknown>) => ({ id: "credentials", ...cfg }),
}));
vi.mock("next-auth/providers/github", () => ({
  default: (cfg: Record<string, unknown>) => ({ id: "github", ...cfg }),
}));

// --- DB seam: control the authorizedUsers allowlist lookup ----------------
const dbState: { authorized: boolean } = { authorized: false };

vi.mock("@/db", () => ({
  db: {
    query: {
      authorizedUsers: {
        findFirst: async () => (dbState.authorized ? { id: "u1", email: "ok@example.com" } : undefined),
      },
      users: {
        findFirst: async () => undefined,
      },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  users: {},
  accounts: {},
  sessions: {},
  verificationTokens: {},
  authorizedUsers: { email: "email" },
}));

vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/encryption", () => ({ encrypt: (x: string) => x, decryptSafe: (x: string) => x }));
vi.mock("@/lib/github-scopes", () => ({ GITHUB_SCOPE_STRING: "" }));
vi.mock("@/lib/auth-cookies", () => ({ buildScopedCookies: () => undefined }));
vi.mock("@/lib/base-path", () => ({ BASE_PATH: "" }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
vi.mock("drizzle-orm", () => ({ eq: (...args: unknown[]) => args }));

type ProviderLike = {
  id?: string;
  type?: string;
  name?: string;
  authorization?: { params?: { scope?: string } };
};

function findProvider(config: NextAuthConfig | undefined, id: string): ProviderLike | undefined {
  return (config?.providers as ProviderLike[] | undefined)?.find((p) => p?.id === id);
}

/** Invoke the captured `signIn` callback with a minimal arg shape. */
async function callSignIn(
  config: NextAuthConfig | undefined,
  provider: string,
  email: string | null,
): Promise<boolean | undefined> {
  const signIn = config?.callbacks?.signIn;
  if (!signIn) throw new Error("signIn callback was not captured");
  // The callback only reads `user.email` and `account.provider`.
  return signIn({
    user: { email } as never,
    account: { provider } as never,
  } as never) as Promise<boolean | undefined>;
}

function setOidcEnv(): void {
  vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
  vi.stubEnv("OIDC_CLIENT_ID", "client-123");
  vi.stubEnv("OIDC_CLIENT_SECRET", "secret-xyz");
  vi.stubEnv("OIDC_NAME", "Acme SSO");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  capturedConfig = undefined;
  dbState.authorized = false;
  // Clear inherited values so each test sets exactly what it needs.
  vi.stubEnv("OIDC_ISSUER", "");
  vi.stubEnv("OIDC_CLIENT_ID", "");
  vi.stubEnv("OIDC_CLIENT_SECRET", "");
  vi.stubEnv("OIDC_NAME", "");
  vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "");
  vi.stubEnv("AUTH_URL", "http://localhost:6001");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OIDC provider registration", () => {
  it("registers the OIDC provider when issuer + client id + secret are all set", async () => {
    setOidcEnv();
    await import("@/auth");

    const oidc = findProvider(capturedConfig, "oidc");
    expect(oidc).toBeDefined();
    expect(oidc?.type).toBe("oidc");
    expect(oidc?.name).toBe("Acme SSO");
    // The `email` scope must be requested so the allowlist gate has an email
    // to check (otherwise the hardened gate would lock out everyone).
    expect(oidc?.authorization?.params?.scope).toContain("email");
  });

  it("does NOT register the OIDC provider when env is unconfigured", async () => {
    // beforeEach leaves OIDC_* empty.
    await import("@/auth");

    expect(findProvider(capturedConfig, "oidc")).toBeUndefined();
    // GitHub + Credentials are still present.
    expect(findProvider(capturedConfig, "github")).toBeDefined();
    expect(findProvider(capturedConfig, "credentials")).toBeDefined();
  });

  it("does NOT register the OIDC provider when only some OIDC vars are set", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "client-123");
    // OIDC_CLIENT_SECRET intentionally missing.
    await import("@/auth");

    expect(findProvider(capturedConfig, "oidc")).toBeUndefined();
  });
});

describe("signIn callback — OIDC allowlist gate (default-deny)", () => {
  it("rejects an OIDC sign-in whose email is NOT in authorizedUsers", async () => {
    setOidcEnv();
    dbState.authorized = false;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "oidc", "stranger@example.com")).resolves.toBe(false);
  });

  it("allows an OIDC sign-in whose email IS in authorizedUsers", async () => {
    setOidcEnv();
    dbState.authorized = true;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "oidc", "ok@example.com")).resolves.toBe(true);
  });

  it("DENIES an OIDC sign-in with NO email even if the allowlist would match", async () => {
    // CRITICAL regression guard: an IdP that returns no `email` claim must be
    // rejected. `dbState.authorized = true` proves the denial comes from the
    // missing email (the gate returns before the lookup), not a failed lookup.
    setOidcEnv();
    dbState.authorized = true;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "oidc", null)).resolves.toBe(false);
  });

  it("applies the same gate to GitHub (rejects when not allowlisted)", async () => {
    dbState.authorized = false;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "github", "stranger@example.com")).resolves.toBe(false);
  });

  it("DENIES a GitHub sign-in with NO email too (same hardening)", async () => {
    dbState.authorized = true;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "github", null)).resolves.toBe(false);
  });

  it("does not gate other providers (e.g. credentials passes through)", async () => {
    // Credentials is gated inside its own authorize(); the signIn callback must
    // not block it. An unrelated provider with no email must still return true.
    dbState.authorized = false;
    await import("@/auth");

    await expect(callSignIn(capturedConfig, "credentials", "local@example.com")).resolves.toBe(true);
  });
});
