// @vitest-environment node
/**
 * Tests for the pure helpers in `src/server/proxy-ws-bridge.ts` (B3,
 * remote-dev-4oyg): the `PROXY_WS_PATH_PATTERN` / `parseProxyWsPath`
 * path-stripping logic and `normalizeProxyCloseCode`.
 *
 * `PROXY_WS_PATH_PATTERN` is built from `BASE_PATH`, which `base-path.ts` reads
 * once at module load. To exercise both empty and prefixed deployments we clear
 * vitest's module cache (`vi.resetModules`) and re-`import()` the bridge module
 * after mutating `RDV_BASE_PATH` — the same convention as `base-path.test.ts`.
 *
 * The bridging side (`handleProxyWsUpgrade`) opens real sockets and is exercised
 * end-to-end at a higher level; here we lock in the load-bearing pure logic.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_BASE_PATH = process.env.RDV_BASE_PATH;

async function loadBridge(
  basePath: string | undefined,
): Promise<typeof import("../proxy-ws-bridge")> {
  vi.resetModules();
  if (basePath === undefined) delete process.env.RDV_BASE_PATH;
  else process.env.RDV_BASE_PATH = basePath;
  return await import("../proxy-ws-bridge");
}

afterEach(() => {
  if (ORIGINAL_BASE_PATH === undefined) delete process.env.RDV_BASE_PATH;
  else process.env.RDV_BASE_PATH = ORIGINAL_BASE_PATH;
  vi.resetModules();
});

describe("parseProxyWsPath / PROXY_WS_PATH_PATTERN — empty BASE_PATH", () => {
  it("strips the /proxy/<port> prefix, keeping the rest as upstreamPath", async () => {
    const { parseProxyWsPath } = await loadBridge("");
    expect(parseProxyWsPath("/proxy/6000/_hmr")).toEqual({
      port: 6000,
      upstreamPath: "/_hmr",
    });
  });

  it("defaults upstreamPath to / when nothing follows the port", async () => {
    const { parseProxyWsPath } = await loadBridge("");
    expect(parseProxyWsPath("/proxy/6000")).toEqual({
      port: 6000,
      upstreamPath: "/",
    });
    expect(parseProxyWsPath("/proxy/6000/")).toEqual({
      port: 6000,
      upstreamPath: "/",
    });
  });

  it("preserves a deep upstream path", async () => {
    const { parseProxyWsPath } = await loadBridge("");
    expect(parseProxyWsPath("/proxy/3000/ws/socket.io/")).toEqual({
      port: 3000,
      upstreamPath: "/ws/socket.io/",
    });
  });

  it("returns null for non-proxy and non-numeric-port paths", async () => {
    const { parseProxyWsPath, PROXY_WS_PATH_PATTERN } = await loadBridge("");
    expect(parseProxyWsPath("/ws")).toBeNull();
    expect(parseProxyWsPath("/proxy/notaport/x")).toBeNull();
    expect(parseProxyWsPath("/proxyzz/6000")).toBeNull();
    expect(PROXY_WS_PATH_PATTERN.test("/ws")).toBe(false);
    expect(PROXY_WS_PATH_PATTERN.test("/proxy/6000/x")).toBe(true);
  });
});

describe("parseProxyWsPath / PROXY_WS_PATH_PATTERN — BASE_PATH=/alpha", () => {
  it("matches the prefixed path and strips /alpha/proxy/<port>", async () => {
    const { parseProxyWsPath } = await loadBridge("/alpha");
    expect(parseProxyWsPath("/alpha/proxy/6000/_hmr")).toEqual({
      port: 6000,
      upstreamPath: "/_hmr",
    });
    expect(parseProxyWsPath("/alpha/proxy/6000")).toEqual({
      port: 6000,
      upstreamPath: "/",
    });
  });

  it("does NOT match the unprefixed path when a basePath is set", async () => {
    const { parseProxyWsPath, PROXY_WS_PATH_PATTERN } =
      await loadBridge("/alpha");
    expect(parseProxyWsPath("/proxy/6000/_hmr")).toBeNull();
    expect(PROXY_WS_PATH_PATTERN.test("/proxy/6000/_hmr")).toBe(false);
    expect(PROXY_WS_PATH_PATTERN.test("/alpha/proxy/6000/_hmr")).toBe(true);
  });
});

describe("normalizeProxyCloseCode (RFC 6455 §7.4)", () => {
  it("preserves codes an endpoint may legitimately send", async () => {
    const { normalizeProxyCloseCode } = await loadBridge("");
    for (const code of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 3000, 4000, 4999]) {
      expect(normalizeProxyCloseCode(code)).toBe(code);
    }
  });

  it("maps reserved/internal and out-of-range codes to 1011", async () => {
    const { normalizeProxyCloseCode } = await loadBridge("");
    for (const code of [1004, 1005, 1006, 1012, 1013, 1014, 1015, 999, 5000, 0]) {
      expect(normalizeProxyCloseCode(code)).toBe(1011);
    }
  });
});

describe("isAllowedProxyOrigin (remote-dev-kn0q)", () => {
  const ORIGINAL_AUTH_URL = process.env.AUTH_URL;

  afterEach(() => {
    if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  });

  /** No forwarded headers — origin must be matched against AUTH_URL only. */
  const noHeaders = () => undefined;

  it("rejects a missing Origin (browsers always send one)", async () => {
    process.env.AUTH_URL = "https://rdv.example.com";
    const { isAllowedProxyOrigin } = await loadBridge("");
    expect(isAllowedProxyOrigin(undefined, noHeaders)).toBe(false);
  });

  it("accepts an Origin matching AUTH_URL", async () => {
    process.env.AUTH_URL = "https://rdv.example.com";
    const { isAllowedProxyOrigin } = await loadBridge("");
    expect(isAllowedProxyOrigin("https://rdv.example.com", noHeaders)).toBe(
      true,
    );
  });

  it("rejects a cross-origin Origin (different host)", async () => {
    process.env.AUTH_URL = "https://rdv.example.com";
    const { isAllowedProxyOrigin } = await loadBridge("");
    expect(isAllowedProxyOrigin("https://evil.example", noHeaders)).toBe(false);
  });

  it("rejects a scheme/port mismatch against AUTH_URL", async () => {
    process.env.AUTH_URL = "https://rdv.example.com";
    const { isAllowedProxyOrigin } = await loadBridge("");
    // http vs https, and an explicit port, both differ from the https origin.
    expect(isAllowedProxyOrigin("http://rdv.example.com", noHeaders)).toBe(
      false,
    );
    expect(
      isAllowedProxyOrigin("https://rdv.example.com:8443", noHeaders),
    ).toBe(false);
  });

  it("accepts an Origin matching the edge-forwarded public host", async () => {
    delete process.env.AUTH_URL;
    const { isAllowedProxyOrigin } = await loadBridge("");
    const headers = (name: string): string | undefined =>
      ({
        "x-forwarded-host": "rdv.example.com",
        "x-forwarded-proto": "https",
      })[name];
    expect(isAllowedProxyOrigin("https://rdv.example.com", headers)).toBe(true);
    expect(isAllowedProxyOrigin("https://evil.example", headers)).toBe(false);
  });

  it("accepts a localhost dev Origin matching AUTH_URL", async () => {
    process.env.AUTH_URL = "http://localhost:6001";
    const { isAllowedProxyOrigin } = await loadBridge("");
    expect(isAllowedProxyOrigin("http://localhost:6001", noHeaders)).toBe(true);
    expect(isAllowedProxyOrigin("http://localhost:6002", noHeaders)).toBe(
      false,
    );
  });

  it("rejects an unparseable Origin value", async () => {
    process.env.AUTH_URL = "https://rdv.example.com";
    const { isAllowedProxyOrigin } = await loadBridge("");
    expect(isAllowedProxyOrigin("null", noHeaders)).toBe(false);
    expect(isAllowedProxyOrigin("not a url", noHeaders)).toBe(false);
  });
});
