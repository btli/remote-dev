// @vitest-environment node
/**
 * Tests for `GET /api/ports/:port/proxy-token` (remote-dev-kn0q) — the
 * membership-gated mint for port-bound proxy WS tokens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const isPortProxyableForUser = vi.hoisted(() => vi.fn());
vi.mock("@/services/proxyable-ports-service", () => ({ isPortProxyableForUser }));

type TokenRouteContext = { params: Promise<{ port: string }> };

function ctx(port: string): TokenRouteContext {
  return { params: Promise.resolve({ port }) };
}

function req(input: string): NextRequest {
  return new Request(input) as unknown as NextRequest;
}

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-proxy-token-route";
  isPortProxyableForUser.mockReset();
  isPortProxyableForUser.mockResolvedValue(true);
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

describe("GET /api/ports/:port/proxy-token", () => {
  it("rejects a non-numeric port with 400 INVALID_PORT", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("http://localhost/api/ports/abc/proxy-token"), ctx("abc"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_PORT" });
    expect(isPortProxyableForUser).not.toHaveBeenCalled();
  });

  it("rejects a hard-blocked port (6001) with 403 PORT_BLOCKED", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("http://localhost/api/ports/6001/proxy-token"), ctx("6001"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "PORT_BLOCKED" });
    // Syntactic gate fires before the membership query.
    expect(isPortProxyableForUser).not.toHaveBeenCalled();
  });

  it("rejects a port not in the user's proxyable set with 403 PORT_NOT_PROXYABLE", async () => {
    isPortProxyableForUser.mockResolvedValue(false);
    const { GET } = await import("./route");
    const res = await GET(req("http://localhost/api/ports/9999/proxy-token"), ctx("9999"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "PORT_NOT_PROXYABLE",
    });
    expect(isPortProxyableForUser).toHaveBeenCalledWith("user-1", 9999);
  });

  it("mints a port-bound proxy token for a proxyable port", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("http://localhost/api/ports/6000/proxy-token"), ctx("6000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ port: 6000, expiresIn: 300 });
    expect(typeof body.token).toBe("string");

    // The minted token must validate for THIS port and reject a different one.
    const { validateProxyWsToken } = await import("@/lib/ws-token");
    expect(validateProxyWsToken(body.token, 6000)).toEqual({
      userId: "user-1",
      port: 6000,
    });
    expect(validateProxyWsToken(body.token, 6001)).toBeNull();
  });
});
