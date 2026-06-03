// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

// base-path defaults to unscoped (BASE_PATH="", INSTANCE_SLUG="") in tests, so
// proxy URLs are rewritten to "/proxy/<port>/…" with no slug prefix.

/**
 * The exported handlers carry Next's generated catch-all signature: a context
 * of `{ params: Promise<{ port: string; path: string[] }> }`. We mirror that
 * shape here so the test typechecks against the real export.
 */
type ProxyRouteContext = { params: Promise<{ port: string; path: string[] }> };

/**
 * Build the dynamic-route context the way Next.js invokes the handler.
 *
 * A `[...path]` catch-all resolves to a `string[]` (one entry per URL segment),
 * or is absent entirely when the proxied path is empty (`/proxy/<port>/`). The
 * harness mirrors that real runtime shape: pass an array of segments, or omit
 * `path` for the root case — the handler normalizes a missing/array `path` at
 * runtime, so we bridge the genuine runtime value through `unknown` rather than
 * fabricating a `string[]` that Next's TYPE claims but the RUNTIME omits.
 */
function ctx(port: string, path?: string[]): ProxyRouteContext {
  const params: Record<string, unknown> = {
    port,
    ...(path ? { path } : {}),
  };
  return {
    params: Promise.resolve(params) as ProxyRouteContext["params"],
  };
}

/** The exports type `request` as `NextRequest`; tests build plain `Request`s. */
function req(input: string, init?: RequestInit): NextRequest {
  return new Request(input, init) as unknown as NextRequest;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("port proxy route", () => {
  it("rejects a non-numeric port with 400 INVALID_PORT", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/abc/"),
      ctx("abc"),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_PORT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a hard-blocked instance port (6001) with 403 PORT_BLOCKED", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/6001/"),
      ctx("6001"),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "PORT_BLOCKED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a privileged port (<1024) with 403", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("http://localhost/proxy/80/"), ctx("80"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the loopback upstream for a proxyable port", async () => {
    fetchMock.mockResolvedValue(
      new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/foo?x=1"),
      ctx("3000", ["foo"]),
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3000/foo?x=1");
    // The fetch is bounded by a timeout signal.
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("joins a multi-segment catch-all path into the upstream URL", async () => {
    // Next resolves `/proxy/6000/api/data` to params.path = ["api", "data"].
    // Passing a bare string here would throw on `.join`; an array is the real
    // shape and exercises the catch-all normalization.
    fetchMock.mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/6000/api/data?q=1"),
      ctx("6000", ["api", "data"]),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    // Multi-segment path joined with "/", query string still appended.
    expect(url).toBe("http://127.0.0.1:6000/api/data?q=1");
  });

  it("treats an absent catch-all (root path) as upstream '/'", async () => {
    // `/proxy/6000/` → params.path is undefined; upstream must be the root.
    fetchMock.mockResolvedValue(
      new Response("root", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/6000/?z=9"),
      ctx("6000"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:6000/?z=9");
  });

  it("strips the caller's credentials from the upstream request", async () => {
    // The upstream is untrusted in-pod code; we must NOT hand it the host-scoped
    // creds this proxy authenticates with (session/CF-Access cookie, API-key
    // bearer, or any Cloudflare Access header). Benign app headers pass through.
    fetchMock.mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/", {
        headers: {
          cookie: "authjs.session-token=secret; CF_Authorization=jwt",
          authorization: "Bearer api-key-123",
          "cf-access-jwt-assertion": "eyJ.jwt.sig",
          "cf-access-authenticated-user-email": "owner@example.com",
          "x-cf-user-email": "owner@example.com",
          accept: "text/html",
        },
      }),
      ctx("3000"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cf-access-jwt-assertion")).toBe(false);
    expect(headers.has("cf-access-authenticated-user-email")).toBe(false);
    expect(headers.has("x-cf-user-email")).toBe(false);
    // A normal app header is still forwarded.
    expect(headers.get("accept")).toBe("text/html");
  });

  it("injects a <base> tag into proxied HTML", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><head><title>x</title></head><body>hi</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<base href="/proxy/3000/">');
  });

  it("returns a friendly 502 when the upstream refuses the connection", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("Nothing is listening on port 3000");
  });

  it("returns a distinct friendly 502 when the upstream times out", async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("did not respond in time");
  });

  it("returns a generic friendly 502 for other upstream failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("something else broke"));
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("Failed to reach port 3000");
  });

  it("rewrites a root-relative Location redirect under the proxy base", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/login" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      req("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/proxy/3000/login");
  });
});
