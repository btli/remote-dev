/**
 * Tests for `src/proxy.ts` — the Next.js 16 auth boundary (proxy/middleware).
 *
 * Focus: the NextAuth fallback gating logic, which branches on whether the proxy
 * realm can see `AUTH_SECRET`:
 *
 *   - SECRET PRESENT  → full `getToken()` cryptographic validation (single-server,
 *     local dev, single-host prod). This path must stay byte-identical (AC-1).
 *   - SECRET ABSENT   → session-cookie PRESENCE gate (the Next standalone instance
 *     proxy realm, where neither the runtime secret nor a shared globalThis is
 *     available). No getToken; logged-in iff a candidate cookie is present.
 *
 * The proxy only touches a small surface of `NextRequest` (`nextUrl.pathname`,
 * `headers.get`, `cookies.has`, `url`), so we build a light fake rather than a
 * real NextRequest. `getToken` and the Cloudflare-Access helpers are mocked;
 * `base-path`/`auth-cookies` are mocked so the candidate names and prefix are
 * deterministic regardless of the test runner's env.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { NextRequest } from "next/server";

// --- Mocks (must be declared before importing the module under test) ---------

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("@/lib/cloudflare-access", () => ({
  // Default: no CF Access token present → fall through to the NextAuth branch.
  getAccessToken: vi.fn(() => null),
  validateAccessJWT: vi.fn(async () => null),
}));

// Default candidate set models a scoped (multi-instance) deployment. Individual
// tests override via vi.mocked(...).mockReturnValueOnce(...) when needed.
vi.mock("@/lib/auth-cookies", () => ({
  getSessionCookieName: vi.fn(() => "__Secure-rdv-dev-session-token"),
  getSessionCookieNameCandidates: vi.fn(() => [
    "__Secure-rdv-dev-session-token",
    "rdv-dev-session-token",
  ]),
}));

vi.mock("@/lib/base-path", () => ({
  INSTANCE_SLUG: "dev",
  // prefixPath is exercised by the redirect tests; mirror the real semantics.
  prefixPath: (input: string) =>
    input === "/" ? "/dev" : input.startsWith("/") ? `/dev${input}` : input,
}));

import { proxy } from "../../proxy";
import { getToken } from "next-auth/jwt";
import { getAccessToken, validateAccessJWT } from "@/lib/cloudflare-access";
import { getSessionCookieNameCandidates } from "@/lib/auth-cookies";

const getTokenMock = getToken as unknown as Mock;
const getAccessTokenMock = getAccessToken as unknown as Mock;
const validateAccessJWTMock = validateAccessJWT as unknown as Mock;
const candidatesMock = getSessionCookieNameCandidates as unknown as Mock;

/**
 * Build a minimal NextRequest-shaped fake. `cookies` is the set of cookie names
 * present on the request; `headers` is an optional header map.
 */
function makeRequest(
  pathname: string,
  opts: { cookies?: string[]; headers?: Record<string, string> } = {},
): NextRequest {
  const cookieSet = new Set(opts.cookies ?? []);
  const headers = new Headers(opts.headers ?? {});
  return {
    nextUrl: { pathname },
    url: `https://host${pathname}`,
    headers,
    cookies: {
      has: (name: string) => cookieSet.has(name),
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessTokenMock.mockReturnValue(null);
  validateAccessJWTMock.mockResolvedValue(null);
  candidatesMock.mockReturnValue([
    "__Secure-rdv-dev-session-token",
    "rdv-dev-session-token",
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — secret-present branch (single-server / AC-1)", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "a-real-secret");
  });

  it("uses getToken (NOT the presence gate) to decide login", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1" });
    const req = makeRequest("/dashboard");

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    // Presence-gate helper must not be consulted when the secret is present.
    expect(candidatesMock).not.toHaveBeenCalled();
    // Authenticated page request passes through (no redirect).
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("redirects an unauthenticated page request to the prefixed /login", async () => {
    getTokenMock.mockResolvedValue(null);
    const req = makeRequest("/dashboard");

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://host/dev/login");
  });

  it("a present session cookie does NOT bypass getToken (crypto validation wins)", async () => {
    // Even with a candidate cookie present, an invalid/empty token → not logged in.
    getTokenMock.mockResolvedValue(null);
    const req = makeRequest("/dashboard", {
      cookies: ["__Secure-rdv-dev-session-token"],
    });

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://host/dev/login");
  });

  it("returns 401 JSON for an unauthenticated API route with no Bearer token", async () => {
    getTokenMock.mockResolvedValue(null);
    const req = makeRequest("/api/sessions");

    const res = await proxy(req);

    expect(res.status).toBe(401);
  });
});

describe("proxy — secret-absent branch (instance proxy presence gate)", () => {
  beforeEach(() => {
    // The instance proxy realm has no runtime AUTH_SECRET.
    vi.stubEnv("AUTH_SECRET", "");
  });

  it("treats the request as logged-in when a candidate session cookie is present", async () => {
    const req = makeRequest("/dashboard", {
      cookies: ["__Secure-rdv-dev-session-token"],
    });

    const res = await proxy(req);

    // getToken must NOT be called (no secret to validate with).
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(candidatesMock).toHaveBeenCalledTimes(1);
    // Logged in → page passes through, no redirect.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("accepts the BARE candidate cookie too (prefix can't be detected in proxy)", async () => {
    const req = makeRequest("/dashboard", {
      cookies: ["rdv-dev-session-token"],
    });

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("redirects to /login when NO candidate session cookie is present", async () => {
    const req = makeRequest("/dashboard", {
      cookies: ["some-other-cookie"],
    });

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://host/dev/login");
  });

  it("returns 401 for an API route with neither a session cookie nor a Bearer token", async () => {
    const req = makeRequest("/api/sessions", { cookies: [] });

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("allows an API route with a Bearer token through even without a session cookie", async () => {
    const req = makeRequest("/api/sessions", {
      cookies: [],
      headers: { authorization: "Bearer abc123" },
    });

    const res = await proxy(req);

    expect(res.status).toBe(200);
  });

  it("redirects an authenticated user away from /login to the prefixed root", async () => {
    const req = makeRequest("/login", {
      cookies: ["__Secure-rdv-dev-session-token"],
    });

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://host/dev");
  });
});

describe("proxy — Cloudflare Access path is unchanged by the branch", () => {
  it("a valid CF Access JWT authenticates without consulting AUTH_SECRET or cookies", async () => {
    vi.stubEnv("AUTH_SECRET", ""); // even with no secret, CF path wins first
    getAccessTokenMock.mockReturnValue("cf-jwt");
    validateAccessJWTMock.mockResolvedValue({
      email: "u@example.com",
      sub: "cf-sub",
    });
    const req = makeRequest("/dashboard");

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(candidatesMock).not.toHaveBeenCalled();
    expect(res.headers.get("x-cf-user-email")).toBe("u@example.com");
    expect(res.status).toBe(200);
  });
});
