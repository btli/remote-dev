/**
 * Tests for `src/lib/auth-cookies.ts`.
 *
 * `auth-cookies.ts` imports `base-path.ts`, which reads `process.env.RDV_BASE_PATH`
 * once at module load. To exercise multiple env states cleanly we follow the
 * same pattern as `base-path.test.ts`: mutate env, `vi.resetModules()`, then
 * dynamically `await import("../auth-cookies")`. Static top-of-file imports
 * would freeze the first env state and defeat the tests.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;
const ORIGINAL_INSTANCE_SLUG = process.env.RDV_INSTANCE_SLUG;
const ORIGINAL_AUTH_URL = process.env.AUTH_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

async function loadCookies(env: {
  RDV_BASE_PATH?: string;
  RDV_INSTANCE_SLUG?: string;
  AUTH_URL?: string;
  NEXTAUTH_URL?: string;
}): Promise<typeof import("../auth-cookies")> {
  vi.resetModules();
  for (const key of [
    "RDV_BASE_PATH",
    "RDV_INSTANCE_SLUG",
    "AUTH_URL",
    "NEXTAUTH_URL",
  ] as const) {
    if (key in env) {
      const val = env[key];
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
  return await import("../auth-cookies");
}

describe("auth-cookies module", () => {
  afterEach(() => {
    restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
    restoreEnv("RDV_INSTANCE_SLUG", ORIGINAL_INSTANCE_SLUG);
    restoreEnv("AUTH_URL", ORIGINAL_AUTH_URL);
    restoreEnv("NEXTAUTH_URL", ORIGINAL_NEXTAUTH_URL);
    vi.resetModules();
  });

  it("returns undefined when RDV_BASE_PATH is empty (single-server mode)", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com",
    });
    expect(mod.buildScopedCookies()).toBeUndefined();
  });

  it("returns undefined when slug derives to empty string", async () => {
    // RDV_INSTANCE_SLUG explicitly empty should also bail out — slug drives
    // every cookie name, and we never want a literal `__Secure-rdv--…` name.
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "",
      AUTH_URL: "https://example.com",
    });
    expect(mod.buildScopedCookies()).toBeUndefined();
  });

  it("returns a full block with all 7 cookies when slug is set", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies();
    expect(cookies).toBeDefined();
    expect(Object.keys(cookies!).sort()).toEqual(
      [
        "callbackUrl",
        "csrfToken",
        "nonce",
        "pkceCodeVerifier",
        "sessionToken",
        "state",
        "webauthnChallenge",
      ].sort(),
    );
  });

  it("uses __Secure- and __Host- prefixes under https", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.name).toBe("__Secure-rdv-alpha-session-token");
    expect(cookies.callbackUrl.name).toBe("__Secure-rdv-alpha-callback-url");
    expect(cookies.csrfToken.name).toBe("__Host-rdv-alpha-csrf-token");
    expect(cookies.pkceCodeVerifier.name).toBe(
      "__Secure-rdv-alpha-pkce-code-verifier",
    );
    expect(cookies.state.name).toBe("__Secure-rdv-alpha-state");
    expect(cookies.nonce.name).toBe("__Secure-rdv-alpha-nonce");
    expect(cookies.webauthnChallenge.name).toBe(
      "__Secure-rdv-alpha-webauthn-challenge",
    );
  });

  it("drops cookie-name prefixes under http (so the browser accepts them)", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "http://localhost:6101/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.name).toBe("rdv-alpha-session-token");
    expect(cookies.csrfToken.name).toBe("rdv-alpha-csrf-token");
    // No bare __Secure-/__Host- leaks
    for (const cookie of Object.values(cookies)) {
      expect(cookie.name).not.toMatch(/^__(Secure|Host)-/);
    }
  });

  it("drops prefixes when neither AUTH_URL nor NEXTAUTH_URL is set", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: undefined,
      NEXTAUTH_URL: undefined,
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.name).toBe("rdv-alpha-session-token");
  });

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: undefined,
      NEXTAUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.name).toBe("__Secure-rdv-alpha-session-token");
  });

  it("sets options.secure=true under https and false otherwise", async () => {
    const secureMod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    for (const cookie of Object.values(secureMod.buildScopedCookies()!)) {
      expect(cookie.options?.secure).toBe(true);
    }

    const insecureMod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "http://localhost:6101/alpha",
    });
    for (const cookie of Object.values(insecureMod.buildScopedCookies()!)) {
      expect(cookie.options?.secure).toBe(false);
    }
  });

  it("scopes options.path to the basePath for every cookie except csrfToken", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.options?.path).toBe("/alpha");
    expect(cookies.callbackUrl.options?.path).toBe("/alpha");
    expect(cookies.pkceCodeVerifier.options?.path).toBe("/alpha");
    expect(cookies.state.options?.path).toBe("/alpha");
    expect(cookies.nonce.options?.path).toBe("/alpha");
    expect(cookies.webauthnChallenge.options?.path).toBe("/alpha");
    // CSRF must stay at "/" — __Host- prefix requires it per RFC 6265bis.
    expect(cookies.csrfToken.options?.path).toBe("/");
  });

  it("honors a nested basePath like /x/y", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/x/y",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/x/y",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.options?.path).toBe("/x/y");
    // Slug derives from the last segment.
    expect(cookies.sessionToken.name).toBe("__Secure-rdv-y-session-token");
  });

  it("honors an explicit RDV_INSTANCE_SLUG override", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "custom",
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.name).toBe("__Secure-rdv-custom-session-token");
  });

  it("all cookies have sameSite=lax", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    for (const cookie of Object.values(mod.buildScopedCookies()!)) {
      expect(cookie.options?.sameSite).toBe("lax");
    }
  });

  it("session/csrf/pkce/state/nonce/webauthn are httpOnly; callbackUrl is not", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.options?.httpOnly).toBe(true);
    expect(cookies.csrfToken.options?.httpOnly).toBe(true);
    expect(cookies.pkceCodeVerifier.options?.httpOnly).toBe(true);
    expect(cookies.state.options?.httpOnly).toBe(true);
    expect(cookies.nonce.options?.httpOnly).toBe(true);
    expect(cookies.webauthnChallenge.options?.httpOnly).toBe(true);
    // callbackUrl is intentionally not httpOnly — client JS reads it during
    // the OAuth handshake, matching NextAuth's default behavior.
    expect(cookies.callbackUrl.options?.httpOnly).toBeFalsy();
  });
});
