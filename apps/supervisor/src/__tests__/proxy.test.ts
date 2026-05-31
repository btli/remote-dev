import { describe, it, expect, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { proxy } from "@/proxy";

// Build a minimal NextRequest-like object: proxy() only reads
// `nextUrl.pathname` and `headers.get(...)`.
function makeReq(pathname: string, headers: Record<string, string> = {}): NextRequest {
  return {
    nextUrl: { pathname },
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

const ORIGINAL = {
  aud: process.env.SUPERVISOR_CF_ACCESS_AUD,
  team: process.env.SUPERVISOR_CF_ACCESS_TEAM,
};

beforeEach(() => {
  process.env.SUPERVISOR_CF_ACCESS_AUD = ORIGINAL.aud;
  process.env.SUPERVISOR_CF_ACCESS_TEAM = ORIGINAL.team;
});

const PLAUSIBLE_JWT = "aaa.bbb.ccc";

describe("supervisor proxy edge gate (I1)", () => {
  beforeEach(() => {
    process.env.SUPERVISOR_CF_ACCESS_AUD = "aud-123";
    process.env.SUPERVISOR_CF_ACCESS_TEAM = "team-x";
  });

  it("passes static/health/api regardless of token", () => {
    for (const p of ["/_next/static/x.js", "/favicon.ico", "/api/health", "/api/instances"]) {
      expect(proxy(makeReq(p)).status).toBe(200);
    }
  });

  it("401s a page route in prod-config when no token is present", () => {
    const res = proxy(makeReq("/"));
    expect(res.status).toBe(401);
  });

  it("401s when the token is present but NOT structurally a JWT", () => {
    // garbage cookie value (not 3 dot-separated non-empty parts)
    const res = proxy(makeReq("/", { cookie: "CF_Authorization=not-a-jwt" }));
    expect(res.status).toBe(401);
  });

  it("allows a structurally-plausible JWT in the cookie", () => {
    const res = proxy(
      makeReq("/", { cookie: `CF_Authorization=${PLAUSIBLE_JWT}` }),
    );
    expect(res.status).toBe(200);
  });

  it("allows a structurally-plausible JWT in the assertion header", () => {
    const res = proxy(makeReq("/", { "cf-access-jwt-assertion": PLAUSIBLE_JWT }));
    expect(res.status).toBe(200);
  });

  it("rejects an assertion header with empty segments", () => {
    const res = proxy(makeReq("/", { "cf-access-jwt-assertion": "a..c" }));
    expect(res.status).toBe(401);
  });
});

describe("supervisor proxy edge gate — CF not configured (dev)", () => {
  beforeEach(() => {
    delete process.env.SUPERVISOR_CF_ACCESS_AUD;
    delete process.env.SUPERVISOR_CF_ACCESS_TEAM;
  });

  it("allows page routes through (auth handled server-side / local dev)", () => {
    expect(proxy(makeReq("/")).status).toBe(200);
  });
});
