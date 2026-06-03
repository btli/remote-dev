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

  it("returns undefined when slug is set but basePath is empty (Codex S-2)", async () => {
    // Operator misconfig: RDV_INSTANCE_SLUG set, RDV_BASE_PATH unset. Without
    // a basePath we cannot path-scope cookies to anything narrower than `/`,
    // so renaming them to `rdv-<slug>-…` would produce half-scoped state that
    // bypasses AC-1's "no behavior change" guarantee. The gate must bail out
    // and let NextAuth use its built-in defaults.
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "alpha",
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

  it("all NextAuth cookies are httpOnly (including callbackUrl)", async () => {
    // Earlier revisions omitted `httpOnly` on `callbackUrl` claiming it
    // matched NextAuth's default. AuthJS actually deep-merges user options
    // into its defaults, and its default *is* `httpOnly: true`, so the cookie
    // was httpOnly on the wire while the test asserted the opposite — passing
    // for the wrong reason. We now set it explicitly so the helper output and
    // the wire-level behavior agree. (Codex S-1 / Opus C-1.)
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    const cookies = mod.buildScopedCookies()!;
    expect(cookies.sessionToken.options?.httpOnly).toBe(true);
    expect(cookies.callbackUrl.options?.httpOnly).toBe(true);
    expect(cookies.csrfToken.options?.httpOnly).toBe(true);
    expect(cookies.pkceCodeVerifier.options?.httpOnly).toBe(true);
    expect(cookies.state.options?.httpOnly).toBe(true);
    expect(cookies.nonce.options?.httpOnly).toBe(true);
    expect(cookies.webauthnChallenge.options?.httpOnly).toBe(true);
  });
});

describe("getSessionCookieName", () => {
  afterEach(() => {
    restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
    restoreEnv("RDV_INSTANCE_SLUG", ORIGINAL_INSTANCE_SLUG);
    restoreEnv("AUTH_URL", ORIGINAL_AUTH_URL);
    restoreEnv("NEXTAUTH_URL", ORIGINAL_NEXTAUTH_URL);
    vi.resetModules();
  });

  it("returns AuthJS https default when no basePath is set", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com",
    });
    expect(mod.getSessionCookieName()).toBe("__Secure-authjs.session-token");
  });

  it("returns AuthJS http default when no basePath is set under http", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "http://localhost:6001",
    });
    expect(mod.getSessionCookieName()).toBe("authjs.session-token");
  });

  it("returns the scoped name when basePath + slug resolve under https", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/alpha",
    });
    expect(mod.getSessionCookieName()).toBe("__Secure-rdv-alpha-session-token");
  });

  it("returns the unprefixed scoped name under http", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "http://localhost:6101/alpha",
    });
    expect(mod.getSessionCookieName()).toBe("rdv-alpha-session-token");
  });

  it("returns AuthJS default when slug is set without basePath (Codex S-2)", async () => {
    // Mirrors the buildScopedCookies bail-out: getToken() must read the same
    // cookie the auth handler writes, so when scoping is off the name must
    // also be the AuthJS default.
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: "alpha",
      AUTH_URL: "https://example.com",
    });
    expect(mod.getSessionCookieName()).toBe("__Secure-authjs.session-token");
  });
});

describe("getSessionCookieNameCandidates", () => {
  // The proxy realm has neither the secret nor AUTH_URL, so it can't pick the
  // single right cookie name. getSessionCookieNameCandidates() returns BOTH the
  // __Secure- and bare scoped names so the proxy can presence-gate on whichever
  // the auth handler actually set. (For the unscoped/single-server case it
  // returns just the one default name, preserving AC-1.)
  afterEach(() => {
    restoreEnv("RDV_BASE_PATH", ORIGINAL_BASE_PATH);
    restoreEnv("RDV_INSTANCE_SLUG", ORIGINAL_INSTANCE_SLUG);
    restoreEnv("AUTH_URL", ORIGINAL_AUTH_URL);
    restoreEnv("NEXTAUTH_URL", ORIGINAL_NEXTAUTH_URL);
    vi.resetModules();
  });

  it("returns BOTH the __Secure- and bare scoped names when scoped", async () => {
    // AUTH_URL is intentionally absent (the proxy realm has no AUTH_URL); the
    // candidate list must NOT depend on it — both prefixes are returned.
    const mod = await loadCookies({
      RDV_BASE_PATH: "/dev",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: undefined,
      NEXTAUTH_URL: undefined,
    });
    expect(mod.getSessionCookieNameCandidates()).toEqual([
      "__Secure-rdv-dev-session-token",
      "rdv-dev-session-token",
    ]);
  });

  it("returns both scoped names regardless of scheme (https env present)", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/dev",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com/dev",
    });
    expect(mod.getSessionCookieNameCandidates()).toEqual([
      "__Secure-rdv-dev-session-token",
      "rdv-dev-session-token",
    ]);
  });

  it("honors an explicit RDV_INSTANCE_SLUG override in both candidates", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "/alpha",
      RDV_INSTANCE_SLUG: "custom",
      AUTH_URL: undefined,
    });
    expect(mod.getSessionCookieNameCandidates()).toEqual([
      "__Secure-rdv-custom-session-token",
      "rdv-custom-session-token",
    ]);
  });

  it("returns a single AuthJS https default when unscoped (single-server, AC-1)", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "https://example.com",
    });
    expect(mod.getSessionCookieNameCandidates()).toEqual([
      "__Secure-authjs.session-token",
    ]);
  });

  it("returns a single AuthJS http default when unscoped under http", async () => {
    const mod = await loadCookies({
      RDV_BASE_PATH: "",
      RDV_INSTANCE_SLUG: undefined,
      AUTH_URL: "http://localhost:6001",
    });
    expect(mod.getSessionCookieNameCandidates()).toEqual([
      "authjs.session-token",
    ]);
  });
});
