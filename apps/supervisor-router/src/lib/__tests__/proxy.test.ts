import { describe, expect, it, vi } from "vitest";
import type { Server } from "bun";
import {
  buildWsUpgradeHeaders,
  normalizeCloseCode,
  proxyHttp,
} from "@/lib/proxy";

/** A stub Bun server exposing only `requestIP` (what proxyHttp uses). */
function serverWithIp(address: string | null): Pick<Server<unknown>, "requestIP"> {
  return {
    requestIP: () => (address ? { address, family: "IPv4", port: 12345 } : null),
  } as Pick<Server<unknown>, "requestIP">;
}

/**
 * NOTE: the live HTTP/WS *piping* path (a real terminal over the tunnel +
 * Cloudflare Access + router) is the jvcx.11 end-to-end smoke test, not a unit
 * test here. These tests cover the request-shaping the proxy is responsible for:
 * URL construction (path + query preserved), header forwarding (auth kept,
 * hop-by-hop stripped), and the WS upgrade-header builder.
 */

const BASE = "http://rdv.rdv-alpha.svc.cluster.local:6001";

function captureFetch(): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("proxyHttp — URL construction (no prefix stripping, query preserved)", () => {
  it("forwards the UNCHANGED path and the query string", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request(
      "https://dev.example.com/alpha/api/sessions?foo=1&bar=2",
    );
    await proxyHttp(req, BASE, "/alpha/api/sessions", fetchImpl);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/alpha/api/sessions?foo=1&bar=2`);
  });

  it("forwards a path with no query without a trailing '?'", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x");
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl);
    expect(calls[0].url).toBe(`${BASE}/alpha/x`);
  });
});

describe("proxyHttp — header forwarding", () => {
  it("forwards the Cookie (CF_Authorization) and Cf-Access-Jwt-Assertion headers UNCHANGED", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x", {
      headers: {
        cookie: "CF_Authorization=tok123; other=1",
        "cf-access-jwt-assertion": "jwt-abc",
        "x-rdv-instance": "alpha",
      },
    });
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl);

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("cookie")).toBe("CF_Authorization=tok123; other=1");
    expect(headers.get("cf-access-jwt-assertion")).toBe("jwt-abc");
    expect(headers.get("x-rdv-instance")).toBe("alpha");
  });

  it("strips hop-by-hop headers (connection, upgrade, transfer-encoding)", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x", {
      headers: {
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        "x-keep-me": "yes",
      },
    });
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl);

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("keep-alive")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("x-keep-me")).toBe("yes");
  });

  it("preserves the request method", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain" },
    });
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl);
    expect(calls[0].init.method).toBe("POST");
  });
});

describe("proxyHttp — Host stripping + X-Forwarded-* (Fix 2)", () => {
  it("drops the incoming Host and sets X-Forwarded-Host instead", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x", {
      headers: { host: "dev.example.com" },
    });
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl, serverWithIp("203.0.113.7"));

    const headers = new Headers(calls[0].init.headers);
    // The client Host must not be forwarded (the fetch impl sets it to the
    // upstream authority).
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBe("dev.example.com");
  });

  it("defaults X-Forwarded-Proto to https and appends the client IP to XFF", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x");
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl, serverWithIp("203.0.113.7"));

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("preserves an existing X-Forwarded-Proto and appends to an existing XFF chain", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x", {
      headers: {
        "x-forwarded-proto": "http",
        "x-forwarded-for": "198.51.100.1",
      },
    });
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl, serverWithIp("203.0.113.7"));

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("x-forwarded-proto")).toBe("http");
    expect(headers.get("x-forwarded-for")).toBe("198.51.100.1, 203.0.113.7");
  });

  it("works without a server (no client IP available)", async () => {
    const { fetchImpl, calls } = captureFetch();
    const req = new Request("https://dev.example.com/alpha/x");
    await proxyHttp(req, BASE, "/alpha/x", fetchImpl); // no server arg

    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("x-forwarded-proto")).toBe("https");
    // No IP resolvable → no XFF header fabricated.
    expect(headers.get("x-forwarded-for")).toBeNull();
  });
});

describe("normalizeCloseCode (Fix 5)", () => {
  it.each([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 3000, 4000, 4999])(
    "passes through legitimate code %i",
    (code) => {
      expect(normalizeCloseCode(code)).toBe(code);
    },
  );

  it.each([1004, 1005, 1006, 1012, 1013, 1014, 1015, 999, 5000, 0])(
    "maps reserved/internal/out-of-range code %i to 1011",
    (code) => {
      expect(normalizeCloseCode(code)).toBe(1011);
    },
  );
});

describe("proxyHttp — upstream failure", () => {
  it("returns 502 when the upstream fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const req = new Request("https://dev.example.com/alpha/x");
    const res = await proxyHttp(req, BASE, "/alpha/x", fetchImpl);
    expect(res.status).toBe(502);
  });

  it("does not follow upstream redirects (redirect: manual)", async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenInit = init;
      return new Response(null, { status: 302, headers: { location: "/elsewhere" } });
    }) as unknown as typeof fetch;
    const req = new Request("https://dev.example.com/alpha/x");
    const res = await proxyHttp(req, BASE, "/alpha/x", fetchImpl);
    expect(seenInit?.redirect).toBe("manual");
    expect(res.status).toBe(302);
  });
});

describe("buildWsUpgradeHeaders", () => {
  it("carries auth + WS negotiation headers, omits absent ones", () => {
    const req = new Request("https://dev.example.com/alpha/ws", {
      headers: {
        cookie: "CF_Authorization=tok",
        "cf-access-jwt-assertion": "jwt",
        "sec-websocket-protocol": "rdv.v1",
        "user-agent": "test-agent",
      },
    });
    const headers = buildWsUpgradeHeaders(req);
    expect(headers["cookie"]).toBe("CF_Authorization=tok");
    expect(headers["cf-access-jwt-assertion"]).toBe("jwt");
    expect(headers["sec-websocket-protocol"]).toBe("rdv.v1");
    expect(headers["user-agent"]).toBe("test-agent");
    // Absent headers are not fabricated.
    expect(headers["authorization"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });
});
