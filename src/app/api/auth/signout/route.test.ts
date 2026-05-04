/**
 * Sign-out route tests.
 *
 * Coverage:
 *   - GET is not exported (CSRF logout vector defense).
 *   - POST with cross-origin Origin header is rejected (403).
 *   - POST with same-origin Origin header redirects to /login when CF
 *     Access is not configured.
 *   - When `CF_ACCESS_AUD` is set but `CF_ACCESS_TEAM` is missing the
 *     handler logs an error and falls through to /login (no foreign-tenant
 *     redirect).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const signOutMock = vi.fn();
vi.mock("@/auth", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

const errorLogMock = vi.fn();
const warnLogMock = vi.fn();
const infoLogMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: errorLogMock,
    warn: warnLogMock,
    info: infoLogMock,
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

function makeRequest(opts: {
  method: "POST";
  headers?: Record<string, string>;
  url?: string;
}): NextRequest {
  const url = opts.url ?? "https://app.example.com/api/auth/signout";
  const parsed = new URL(url);
  const headers = new Headers(opts.headers ?? {});
  if (!headers.has("host")) headers.set("host", parsed.host);
  return {
    method: opts.method,
    headers,
    nextUrl: parsed,
  } as unknown as NextRequest;
}

beforeEach(() => {
  signOutMock.mockReset();
  signOutMock.mockResolvedValue(undefined);
  errorLogMock.mockReset();
  warnLogMock.mockReset();
  infoLogMock.mockReset();
  // Clear any CF Access env vars so each test sets its own.
  delete process.env.CF_ACCESS_AUD;
  delete process.env.CF_ACCESS_TEAM;
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  vi.resetModules();
});

describe("/api/auth/signout", () => {
  it("does NOT export a GET handler (no CSRF logout vector)", async () => {
    const mod = await import("./route");
    // Intentionally cast through unknown so the test compiles even if a
    // future change accidentally re-introduces GET.
    expect((mod as unknown as { GET?: unknown }).GET).toBeUndefined();
  });

  it("rejects cross-origin POST with 403", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        method: "POST",
        url: "https://app.example.com/api/auth/signout",
        headers: {
          origin: "https://attacker.example.org",
          host: "app.example.com",
        },
      })
    );
    expect(res.status).toBe(403);
    expect(signOutMock).not.toHaveBeenCalled();
    expect(warnLogMock).toHaveBeenCalledWith(
      "Rejected cross-origin sign-out POST",
      expect.any(Object)
    );
  });

  it("accepts same-origin POST and redirects to /login when CF Access is not configured", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        method: "POST",
        url: "https://app.example.com/api/auth/signout",
        headers: {
          origin: "https://app.example.com",
          host: "app.example.com",
        },
      })
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/login");
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to /login (logs error) when CF_ACCESS_AUD is set but CF_ACCESS_TEAM is missing", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    process.env.CF_ACCESS_AUD = "test-audience";
    // CF_ACCESS_TEAM intentionally unset.
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        method: "POST",
        url: "https://app.example.com/api/auth/signout",
        headers: {
          origin: "https://app.example.com",
          host: "app.example.com",
        },
      })
    );
    expect(res.status).toBe(307);
    // Must NOT redirect to *any* `cloudflareaccess.com` domain.
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("cloudflareaccess.com");
    expect(location).toBe("https://app.example.com/login");
    expect(errorLogMock).toHaveBeenCalledWith(
      expect.stringContaining("CF_ACCESS_TEAM not configured")
    );
  });

  it("redirects to the configured Cloudflare Access logout URL when both env vars are set", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    process.env.CF_ACCESS_AUD = "test-audience";
    process.env.CF_ACCESS_TEAM = "my-team";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        method: "POST",
        url: "https://app.example.com/api/auth/signout",
        headers: {
          origin: "https://app.example.com",
          host: "app.example.com",
        },
      })
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("https://my-team.cloudflareaccess.com/cdn-cgi/access/logout");
    expect(location).toContain(encodeURIComponent("https://app.example.com/login"));
  });
});
