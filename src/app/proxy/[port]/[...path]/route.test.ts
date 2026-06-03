// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

// base-path defaults to unscoped (BASE_PATH="", INSTANCE_SLUG="") in tests, so
// proxy URLs are rewritten to "/proxy/<port>/…" with no slug prefix.

/** Build the dynamic-route context the way Next.js invokes the handler. */
function ctx(port: string, path?: string) {
  return { params: Promise.resolve({ port, ...(path ? { path } : {}) }) };
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
      new Request("http://localhost/proxy/abc/"),
      ctx("abc"),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_PORT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a hard-blocked instance port (6001) with 403 PORT_BLOCKED", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/proxy/6001/"),
      ctx("6001"),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "PORT_BLOCKED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a privileged port (<1024) with 403", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/proxy/80/"), ctx("80"));
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
      new Request("http://localhost/proxy/3000/foo?x=1"),
      ctx("3000", "foo"),
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3000/foo?x=1");
    // The fetch is bounded by a timeout signal.
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
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
      new Request("http://localhost/proxy/3000/"),
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
      new Request("http://localhost/proxy/3000/"),
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
      new Request("http://localhost/proxy/3000/"),
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
      new Request("http://localhost/proxy/3000/"),
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
      new Request("http://localhost/proxy/3000/"),
      ctx("3000"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/proxy/3000/login");
  });
});
