/**
 * Tests for `src/proxy.ts` — the Next.js 16 auth boundary (proxy/middleware).
 *
 * Focus: the NextAuth fallback gating logic, which branches on whether the proxy
 * is running SCOPED (a standalone instance pod under `RDV_BASE_PATH`, where
 * `INSTANCE_SLUG` is non-empty) or UNSCOPED (single-server / local dev /
 * single-host prod, where `INSTANCE_SLUG === ""`):
 *
 *   - SCOPED   → session-cookie PRESENCE gate, REGARDLESS of `AUTH_SECRET`. The
 *     instance proxy realm cannot reliably run `getToken()` (the secret is
 *     absent or spuriously truthy, and `AUTH_URL` is empty so it would compute
 *     the wrong cookie-name prefix). No getToken; logged-in iff a candidate
 *     cookie is present.
 *   - UNSCOPED → full `getToken()` cryptographic validation (the main Node
 *     server has the real secret + AUTH_URL). This path must stay byte-identical
 *     (AC-1) — `getToken` is still called with the same args.
 *
 * The proxy only touches a small surface of `NextRequest` (`nextUrl.pathname`,
 * `headers.get`, `cookies.has`, `url`), so we build a light fake rather than a
 * real NextRequest. `getToken` and the Cloudflare-Access helpers are mocked;
 * `base-path`/`auth-cookies` are mocked so the candidate names, prefix, and
 * INSTANCE_SLUG are deterministic regardless of env.
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

// INSTANCE_SLUG is a live binding the proxy reads INSIDE proxy() on every call,
// so a mutable holder + getter lets each test pick scoped ("dev") vs unscoped
// ("") without re-importing the module.
const slugHolder = { value: "dev" };
vi.mock("@/lib/base-path", () => ({
  get INSTANCE_SLUG() {
    return slugHolder.value;
  },
  // prefixPath is exercised by the redirect tests; mirror the real semantics.
  // Unscoped builds no prefix; scoped ("dev") prefixes with /dev.
  prefixPath: (input: string) => {
    if (!input.startsWith("/")) return input;
    if (slugHolder.value === "") return input;
    return input === "/" ? "/dev" : `/dev${input}`;
  },
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
  const cookieNames = opts.cookies ?? [];
  const cookieSet = new Set(cookieNames);
  const headers = new Headers(opts.headers ?? {});
  return {
    // Real NextRequest.nextUrl always exposes `origin`; the proxy reads it as
    // the fallback for resolveExternalOrigin() when no forwarded/host header is
    // present, so the fake must provide it too.
    nextUrl: { pathname, origin: "https://host" },
    url: `https://host${pathname}`,
    headers,
    cookies: {
      has: (name: string) => cookieSet.has(name),
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  slugHolder.value = "dev"; // default: scoped instance proxy realm
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

describe("proxy — scoped instance realm (presence gate, regardless of AUTH_SECRET)", () => {
  // The whole point of the change: in scoped mode the gate is presence-based
  // even when AUTH_SECRET is (spuriously) truthy, because getToken is unreliable
  // in the instance proxy realm. Run the key cases under BOTH secret states.
  for (const secret of ["", "a-spuriously-truthy-secret"]) {
    const label = secret ? "secret present" : "secret absent";

    describe(`AUTH_SECRET ${label}`, () => {
      beforeEach(() => {
        vi.stubEnv("AUTH_SECRET", secret);
      });

      it("treats the request as logged-in when a candidate session cookie is present (no getToken)", async () => {
        const req = makeRequest("/dashboard", {
          cookies: ["__Secure-rdv-dev-session-token"],
        });

        const res = await proxy(req);

        // getToken must NOT be called in scoped mode.
        expect(getTokenMock).not.toHaveBeenCalled();
        expect(candidatesMock).toHaveBeenCalled();
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
    });
  }

  it("returns 401 for an API route with neither a session cookie nor a Bearer token", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const req = makeRequest("/api/sessions", { cookies: [] });

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("allows an API route with a Bearer token through even without a session cookie", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const req = makeRequest("/api/sessions", {
      cookies: [],
      headers: { authorization: "Bearer abc123" },
    });

    const res = await proxy(req);

    expect(res.status).toBe(200);
  });

  it("does NOT redirect a present-cookie request away from /login (renders it, avoiding the stale-cookie loop)", async () => {
    // Scoped isLoggedIn is mere cookie-PRESENCE. If a stale/invalid cookie were
    // bounced /login→/, the Home page's real getAuthSession() would bounce
    // /→/login, looping forever. So in scoped mode /login must render even when
    // a candidate cookie is present; re-authenticating overwrites the stale one.
    vi.stubEnv("AUTH_SECRET", "");
    const req = makeRequest("/login", {
      cookies: ["__Secure-rdv-dev-session-token"],
    });

    const res = await proxy(req);

    expect(getTokenMock).not.toHaveBeenCalled();
    // No redirect — the login page passes through.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });
});

describe("proxy — unscoped single-server (getToken path / AC-1)", () => {
  beforeEach(() => {
    slugHolder.value = ""; // unscoped ⇔ INSTANCE_SLUG === ""
    vi.stubEnv("AUTH_SECRET", "a-real-secret");
  });

  it("uses getToken (NOT the presence gate) to decide login", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1" });
    const req = makeRequest("/dashboard");

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    // Authenticated page request passes through (no redirect).
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("passes the configured cookie name + process.env.AUTH_SECRET to getToken (AC-1, byte-identical)", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1" });
    const req = makeRequest("/dashboard");

    await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock).toHaveBeenCalledWith({
      req,
      secret: "a-real-secret",
      cookieName: "__Secure-rdv-dev-session-token",
    });
  });

  it("redirects an unauthenticated page request to /login", async () => {
    getTokenMock.mockResolvedValue(null);
    const req = makeRequest("/dashboard");

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    // Unscoped → no prefix on the Location.
    expect(res.headers.get("location")).toBe("https://host/login");
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
    expect(res.headers.get("location")).toBe("https://host/login");
  });

  it("returns 401 JSON for an unauthenticated API route with no Bearer token", async () => {
    getTokenMock.mockResolvedValue(null);
    const req = makeRequest("/api/sessions");

    const res = await proxy(req);

    expect(res.status).toBe(401);
  });

  it("STILL redirects a getToken-validated user away from /login to root (real signal → safe, no loop)", async () => {
    // Unscoped isLoggedIn is a REAL crypto signal (a valid token), so the Home
    // page's getAuthSession() would also succeed — bouncing /login→/ is correct
    // here and cannot loop. The guard only suppresses this in scoped mode.
    getTokenMock.mockResolvedValue({ sub: "user-1" });
    const req = makeRequest("/login");

    const res = await proxy(req);

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    // Unscoped → no prefix on the Location.
    expect(res.headers.get("location")).toBe("https://host/");
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
