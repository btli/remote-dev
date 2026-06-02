import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Mock next-auth/jwt's getToken so the dual-auth (session) branch is
// deterministic without a real signed cookie. `tokenState.value` is what
// getToken resolves to (null = no session); `tokenState.lastArgs` captures the
// params the proxy passed so we can assert cookieName/secureCookie (Fix #4).
const tokenState: { value: unknown; lastArgs: Record<string, unknown> | null } = {
  value: null,
  lastArgs: null,
};
vi.mock("next-auth/jwt", () => ({
  getToken: async (args: Record<string, unknown>) => {
    tokenState.lastArgs = args;
    return tokenState.value;
  },
}));

import { proxy } from "@/proxy";

// Build a minimal NextRequest-like object. proxy() reads `nextUrl.pathname`,
// `nextUrl.protocol`, `headers.get(...)`, and (for the redirect path)
// `nextUrl.clone()` + `searchParams`. Back it with a real URL so clone works.
function makeReq(
  pathname: string,
  headers: Record<string, string> = {},
  origin = "https://sup.example.com",
): NextRequest {
  const url = new URL(pathname, origin);
  return {
    nextUrl: url,
    url: url.toString(),
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

const ORIGINAL = {
  aud: process.env.SUPERVISOR_CF_ACCESS_AUD,
  team: process.env.SUPERVISOR_CF_ACCESS_TEAM,
  secret: process.env.AUTH_SECRET,
  authUrl: process.env.AUTH_URL,
};

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  restore("SUPERVISOR_CF_ACCESS_AUD", ORIGINAL.aud);
  restore("SUPERVISOR_CF_ACCESS_TEAM", ORIGINAL.team);
  restore("AUTH_SECRET", ORIGINAL.secret);
  restore("AUTH_URL", ORIGINAL.authUrl);
  tokenState.value = null;
  tokenState.lastArgs = null;
});

const PLAUSIBLE_JWT = "aaa.bbb.ccc";

describe("supervisor proxy edge gate (I1)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_CF_ACCESS_AUD = "aud-123";
    process.env.SUPERVISOR_CF_ACCESS_TEAM = "team-x";
    delete process.env.AUTH_SECRET; // no NextAuth session path unless a test opts in
  });

  it("passes static/health/api regardless of token", async () => {
    for (const p of ["/_next/static/x.js", "/favicon.ico", "/api/health", "/api/instances"]) {
      expect((await proxy(makeReq(p))).status).toBe(200);
    }
  });

  it("401s a page route in prod-config when no token is present", async () => {
    const res = await proxy(makeReq("/"));
    expect(res.status).toBe(401);
  });

  it("401s when the token is present but NOT structurally a JWT", async () => {
    // garbage cookie value (not 3 dot-separated non-empty parts)
    const res = await proxy(makeReq("/", { cookie: "CF_Authorization=not-a-jwt" }));
    expect(res.status).toBe(401);
  });

  it("allows a structurally-plausible JWT in the cookie", async () => {
    const res = await proxy(
      makeReq("/", { cookie: `CF_Authorization=${PLAUSIBLE_JWT}` }),
    );
    expect(res.status).toBe(200);
  });

  it("allows a structurally-plausible JWT in the assertion header", async () => {
    const res = await proxy(makeReq("/", { "cf-access-jwt-assertion": PLAUSIBLE_JWT }));
    expect(res.status).toBe(200);
  });

  it("rejects an assertion header with empty segments", async () => {
    const res = await proxy(makeReq("/", { "cf-access-jwt-assertion": "a..c" }));
    expect(res.status).toBe(401);
  });
});

describe("supervisor proxy — login + nextauth always reachable", () => {
  beforeEach(() => {
    // Even with CF configured (the strict case), the login flow must be open.
    process.env.SUPERVISOR_CF_ACCESS_AUD = "aud-123";
    process.env.SUPERVISOR_CF_ACCESS_TEAM = "team-x";
    delete process.env.AUTH_SECRET;
  });

  it("passes /login with no token", async () => {
    expect((await proxy(makeReq("/login"))).status).toBe(200);
  });

  it("passes /api/auth/* with no token", async () => {
    for (const p of [
      "/api/auth/signin",
      "/api/auth/callback/oidc",
      "/api/auth/session",
    ]) {
      expect((await proxy(makeReq(p))).status).toBe(200);
    }
  });
});

describe("supervisor proxy — dual auth (NextAuth session)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_CF_ACCESS_AUD = "aud-123";
    process.env.SUPERVISOR_CF_ACCESS_TEAM = "team-x";
    process.env.AUTH_SECRET = "test-secret";
  });

  it("allows a page route when a valid NextAuth session exists (no CF token)", async () => {
    tokenState.value = { email: "user@example.com" };
    const res = await proxy(makeReq("/"));
    expect(res.status).toBe(200);
  });

  it("401s a page route when neither CF token nor session exists", async () => {
    tokenState.value = null;
    const res = await proxy(makeReq("/"));
    expect(res.status).toBe(401);
  });

  it("passes the SECURE cookieName + secureCookie to getToken on HTTPS (Fix #4)", async () => {
    process.env.AUTH_URL = "https://sup.example.com";
    tokenState.value = { email: "user@example.com" };
    await proxy(makeReq("/"));
    expect(tokenState.lastArgs?.cookieName).toBe("__Secure-authjs.session-token");
    expect(tokenState.lastArgs?.secureCookie).toBe(true);
    expect(tokenState.lastArgs?.secret).toBe("test-secret");
  });

  it("passes the NON-secure cookieName when AUTH_URL is http (dev)", async () => {
    process.env.AUTH_URL = "http://localhost:6003";
    tokenState.value = { email: "user@example.com" };
    await proxy(makeReq("/", {}, "http://localhost:6003"));
    expect(tokenState.lastArgs?.cookieName).toBe("authjs.session-token");
    expect(tokenState.lastArgs?.secureCookie).toBe(false);
  });
});

describe("supervisor proxy — OIDC-only edge gate (CF not configured, AUTH_SECRET set)", () => {
  beforeEach(() => {
    delete process.env.SUPERVISOR_CF_ACCESS_AUD;
    delete process.env.SUPERVISOR_CF_ACCESS_TEAM;
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_URL = "https://sup.example.com";
  });

  it("redirects an unauthenticated page route to /login (Fix #3)", async () => {
    tokenState.value = null;
    const res = await proxy(makeReq("/instances/new"));
    expect(res.status).toBe(307); // NextResponse.redirect default
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Finstances%2Fnew");
  });

  it("passes a page route with a valid NextAuth session", async () => {
    tokenState.value = { email: "user@example.com" };
    expect((await proxy(makeReq("/"))).status).toBe(200);
  });

  it("still passes /login and /api/auth/* without a session", async () => {
    tokenState.value = null;
    expect((await proxy(makeReq("/login"))).status).toBe(200);
    expect((await proxy(makeReq("/api/auth/signin"))).status).toBe(200);
  });
});

describe("supervisor proxy edge gate — neither CF nor OIDC (local dev)", () => {
  beforeEach(() => {
    delete process.env.SUPERVISOR_CF_ACCESS_AUD;
    delete process.env.SUPERVISOR_CF_ACCESS_TEAM;
    delete process.env.AUTH_SECRET;
  });

  it("allows page routes through (auth handled server-side / local dev)", async () => {
    expect((await proxy(makeReq("/"))).status).toBe(200);
  });
});
