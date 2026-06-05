import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { collectSessionCookies, encodeAuthCookies } from "@/lib/mobile-callback";

const store = (pairs: [string, string][]) => ({
  getAll: () => pairs.map(([name, value]) => ({ name, value })),
});

describe("collectSessionCookies", () => {
  it("returns the single unchunked cookie at the given path", () => {
    expect(
      collectSessionCookies(
        store([["__Secure-rdv-demo-session-token", "abc"]]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ),
    ).toEqual([{ name: "__Secure-rdv-demo-session-token", value: "abc", path: "/demo" }]);
  });

  it("collects chunks in numeric order", () => {
    expect(
      collectSessionCookies(
        store([
          ["__Secure-rdv-demo-session-token.1", "B"],
          ["__Secure-rdv-demo-session-token.0", "A"],
        ]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ).map((c) => c.value),
    ).toEqual(["A", "B"]);
  });

  it("does not substring-match siblings", () => {
    expect(
      collectSessionCookies(
        store([
          ["__Secure-rdv-demo-session-token", "A"],
          ["__Secure-rdv-demo-callback-url", "X"],
        ]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ),
    ).toHaveLength(1);
  });

  it("returns [] when absent", () => {
    expect(collectSessionCookies(store([]), "x", "/")).toEqual([]);
  });
});

describe("encodeAuthCookies", () => {
  it("round-trips via base64url JSON", () => {
    const enc = encodeAuthCookies([{ name: "a", value: "b", path: "/" }]);
    expect(enc).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(enc, "base64url").toString())).toEqual([
      { name: "a", value: "b", path: "/" },
    ]);
  });
});

// ─── Task 2: resolveInstanceMobileCallback ───────────────────────────────────

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("@/lib/cloudflare-access", () => ({
  validateAccessJWT: vi.fn(),
}));
vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getOrCreateUserByEmail: vi.fn(),
}));
vi.mock("@/services/api-key-service", () => ({
  createApiKey: vi.fn(),
}));
vi.mock("@/lib/auth-cookies", () => ({
  getSessionCookieName: vi.fn(),
}));
vi.mock("@/lib/base-path", () => ({
  COOKIE_PATH: "/demo",
  prefixPath: (p: string) => `/demo${p}`,
}));

import { resolveInstanceMobileCallback } from "@/lib/mobile-callback";
import { cookies } from "next/headers";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { getAuthSession } from "@/lib/auth-utils";
import { getOrCreateUserByEmail } from "@/lib/user-identity";
import { createApiKey } from "@/services/api-key-service";
import { getSessionCookieName } from "@/lib/auth-cookies";

/** Parse the query params from a `remotedev://…` deep link. */
function parseDeepLink(url: string): URLSearchParams {
  return new URL(url.replace("remotedev://", "https://remotedev.local/")).searchParams;
}

import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

/** Build a minimal mock cookie store that satisfies ReadonlyRequestCookies. */
function makeCookieStore(pairs: [string, string][]): ReadonlyRequestCookies {
  return {
    get: (name: string) => {
      const hit = pairs.find(([n]) => n === name);
      return hit ? { name: hit[0], value: hit[1] } : undefined;
    },
    getAll: () => pairs.map(([name, value]) => ({ name, value })),
    has: (name: string) => pairs.some(([n]) => n === name),
    size: pairs.length,
    [Symbol.iterator]: function* () {
      for (const [name, value] of pairs) yield { name, value };
    },
  } as unknown as ReadonlyRequestCookies;
}

describe("resolveInstanceMobileCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("(a) CF valid → redirect with scope=instance, apiKey, cfToken, authCookies", async () => {
    const CF_TOKEN = "cf-jwt-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([["CF_Authorization", CF_TOKEN]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(validateAccessJWT).mockResolvedValue({ email: "user@example.com", sub: "cf-sub-123" });
    vi.mocked(getOrCreateUserByEmail).mockResolvedValue({
      id: "user-123",
      email: "user@example.com",
      name: null,
    });
    vi.mocked(createApiKey).mockResolvedValue({
      id: "key-id",
      name: "Mobile App",
      key: "rdv_apikey123",
      keyPrefix: "rdv_apikey",
      createdAt: new Date(),
    });

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("redirect");
    const params = parseDeepLink((result as { kind: "redirect"; url: string }).url);
    expect(params.get("scope")).toBe("instance");
    expect(params.get("apiKey")).toBe("rdv_apikey123");
    expect(params.get("cfToken")).toBe(CF_TOKEN);
    const authCookies = JSON.parse(
      Buffer.from(params.get("authCookies")!, "base64url").toString(),
    );
    expect(authCookies).toEqual([{ name: "CF_Authorization", value: CF_TOKEN, path: "/" }]);
  });

  it("(b) CF token invalid AND no session → login", async () => {
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([["CF_Authorization", "bad-token"]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(validateAccessJWT).mockResolvedValue(null);
    vi.mocked(getAuthSession).mockResolvedValue(null);

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("login");
  });

  it("(c) no CF, OIDC session (single cookie) → redirect with scope=instance and authCookies, no apiKey/cfToken", async () => {
    const SESSION_COOKIE_NAME = "__Secure-rdv-demo-session-token";
    const SESSION_VALUE = "oidc-jwt-value";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([[SESSION_COOKIE_NAME, SESSION_VALUE]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-456", email: "oidc@example.com", name: null },
    });
    vi.mocked(getSessionCookieName).mockReturnValue(SESSION_COOKIE_NAME);

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("redirect");
    const params = parseDeepLink((result as { kind: "redirect"; url: string }).url);
    expect(params.get("scope")).toBe("instance");
    expect(params.has("apiKey")).toBe(false);
    expect(params.has("cfToken")).toBe(false);
    const authCookies = JSON.parse(
      Buffer.from(params.get("authCookies")!, "base64url").toString(),
    );
    expect(authCookies).toEqual([
      { name: SESSION_COOKIE_NAME, value: SESSION_VALUE, path: "/demo" },
    ]);
  });

  it("(c) no CF, OIDC session (chunked) → redirect with authCookies from all chunks", async () => {
    const SESSION_COOKIE_NAME = "__Secure-rdv-demo-session-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([
        [`${SESSION_COOKIE_NAME}.0`, "part-A"],
        [`${SESSION_COOKIE_NAME}.1`, "part-B"],
      ]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-789", email: "oidc2@example.com", name: null },
    });
    vi.mocked(getSessionCookieName).mockReturnValue(SESSION_COOKIE_NAME);

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("redirect");
    const params = parseDeepLink((result as { kind: "redirect"; url: string }).url);
    const authCookies = JSON.parse(
      Buffer.from(params.get("authCookies")!, "base64url").toString(),
    );
    expect(authCookies).toEqual([
      { name: `${SESSION_COOKIE_NAME}.0`, value: "part-A", path: "/demo" },
      { name: `${SESSION_COOKIE_NAME}.1`, value: "part-B", path: "/demo" },
    ]);
  });

  it("OIDC session present but session cookie absent → error", async () => {
    // Authenticated session, but the configured session-cookie name is NOT
    // present in the store (server cookie-name misconfiguration). Redirecting
    // to /login would re-run OIDC and loop back here, so surface an ErrorPage.
    const SESSION_COOKIE_NAME = "__Secure-rdv-demo-session-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([["some-other-cookie", "value"]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-999", email: "oidc3@example.com", name: null },
    });
    vi.mocked(getSessionCookieName).mockReturnValue(SESSION_COOKIE_NAME);

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("error");
  });

  it("(d) nothing → login", async () => {
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(getAuthSession).mockResolvedValue(null);

    const result = await resolveInstanceMobileCallback();

    expect(result.kind).toBe("login");
  });

  // ─── Anti-hijack state echo (remote-dev-gkuo) ──────────────────────────────

  it("echoes the app-supplied state on the CF deep link", async () => {
    const CF_TOKEN = "cf-jwt-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([["CF_Authorization", CF_TOKEN]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(validateAccessJWT).mockResolvedValue({ email: "u@e.com", sub: "s" });
    vi.mocked(getOrCreateUserByEmail).mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: null,
    });
    vi.mocked(createApiKey).mockResolvedValue({
      id: "k",
      name: "Mobile App",
      key: "rdv_k",
      keyPrefix: "rdv_",
      createdAt: new Date(),
    });

    const result = await resolveInstanceMobileCallback({ state: "nonce-xyz" });
    expect(result.kind).toBe("redirect");
    const params = parseDeepLink((result as { kind: "redirect"; url: string }).url);
    expect(params.get("state")).toBe("nonce-xyz");
  });

  it("echoes the app-supplied state on the OIDC deep link", async () => {
    const SESSION_COOKIE_NAME = "__Secure-rdv-demo-session-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([[SESSION_COOKIE_NAME, "v"]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(getAuthSession).mockResolvedValue({
      user: { id: "user-2", email: "o@e.com", name: null },
    });
    vi.mocked(getSessionCookieName).mockReturnValue(SESSION_COOKIE_NAME);

    const result = await resolveInstanceMobileCallback({ state: "nonce-oidc" });
    expect(result.kind).toBe("redirect");
    const params = parseDeepLink((result as { kind: "redirect"; url: string }).url);
    expect(params.get("state")).toBe("nonce-oidc");
  });

  it("omits state when the app supplied none (older app)", async () => {
    const CF_TOKEN = "cf-jwt-token";
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore([["CF_Authorization", CF_TOKEN]]) as ReturnType<typeof makeCookieStore>,
    );
    vi.mocked(validateAccessJWT).mockResolvedValue({ email: "u@e.com", sub: "s" });
    vi.mocked(getOrCreateUserByEmail).mockResolvedValue({
      id: "user-1",
      email: "u@e.com",
      name: null,
    });
    vi.mocked(createApiKey).mockResolvedValue({
      id: "k",
      name: "Mobile App",
      key: "rdv_k",
      keyPrefix: "rdv_",
      createdAt: new Date(),
    });

    const result = await resolveInstanceMobileCallback();
    expect(result.kind).toBe("redirect");
    const url = (result as { kind: "redirect"; url: string }).url;
    expect(parseDeepLink(url).has("state")).toBe(false);
    expect(url).not.toContain("state=");
  });
});
