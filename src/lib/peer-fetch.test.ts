// @vitest-environment node
/**
 * peerFetch / readPeerJson tests — credential attachment, baseUrl+path
 * composition (incl. a Shape-B slug), the `redirect: "manual"` guard, the
 * half-CF-credential rejection, and readPeerJson's error mapping (3xx, 401,
 * 404, non-JSON, success).
 *
 * The encryption module is real (keyed off AUTH_SECRET) so we exercise the
 * actual decrypt path; only `fetch` is faked, by injection.
 */
import { describe, it, expect, vi } from "vitest";

process.env.AUTH_SECRET = "peer-fetch-test-secret";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import { peerFetch, peerUrl, readPeerJson, type PeerTarget } from "./peer-fetch";
import { encrypt } from "./encryption";

const API_KEY = "rdv_live_abcdef1234567890";

function makePeer(overrides: Partial<PeerTarget> = {}): PeerTarget {
  return {
    id: "peer-1",
    name: "homelab",
    baseUrl: "https://rdv.joyful.house/homelab",
    encryptedApiKey: encrypt(API_KEY),
    cfAccessClientId: null,
    encryptedCfAccessSecret: null,
    ...overrides,
  };
}

/** A fetch double that records its args and returns a canned Response. */
function fakeFetch(response = new Response("{}", { status: 200 })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("peerUrl", () => {
  it("composes baseUrl + path, preserving a Shape-B slug", () => {
    expect(
      peerUrl({ baseUrl: "https://rdv.joyful.house/homelab" }, "/api/migration/capabilities"),
    ).toBe("https://rdv.joyful.house/homelab/api/migration/capabilities");
  });

  it("trims a trailing slash and tolerates a path without a leading slash", () => {
    expect(peerUrl({ baseUrl: "https://x.test/" }, "api/migration/imports")).toBe(
      "https://x.test/api/migration/imports",
    );
  });
});

describe("peerFetch", () => {
  it("attaches the decrypted API key and the composed slugged URL", async () => {
    const { impl, calls } = fakeFetch();
    await peerFetch(makePeer(), "/api/migration/capabilities", { method: "GET" }, impl);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://rdv.joyful.house/homelab/api/migration/capabilities",
    );
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("passes redirect:manual through to the underlying fetch", async () => {
    const { impl, calls } = fakeFetch();
    await peerFetch(makePeer(), "/api/migration/capabilities", {}, impl);
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("attaches both CF Access headers when the full pair is present", async () => {
    const { impl, calls } = fakeFetch();
    await peerFetch(
      makePeer({
        cfAccessClientId: "client.access",
        encryptedCfAccessSecret: encrypt("cf-secret"),
      }),
      "/api/migration/capabilities",
      {},
      impl,
    );
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("client.access");
    expect(headers.get("CF-Access-Client-Secret")).toBe("cf-secret");
  });

  it("throws when only the CF Client ID is set (missing secret)", async () => {
    const { impl } = fakeFetch();
    await expect(
      peerFetch(
        makePeer({ cfAccessClientId: "client.access", encryptedCfAccessSecret: null }),
        "/api/migration/capabilities",
        {},
        impl,
      ),
    ).rejects.toThrow(/Client ID is set but the Client Secret is missing/);
  });

  it("throws when only the CF Client Secret is set (missing id)", async () => {
    const { impl } = fakeFetch();
    await expect(
      peerFetch(
        makePeer({ cfAccessClientId: null, encryptedCfAccessSecret: encrypt("cf-secret") }),
        "/api/migration/capabilities",
        {},
        impl,
      ),
    ).rejects.toThrow(/Client Secret is set but the Client ID is missing/);
  });

  it("throws an actionable error when the stored API key cannot be decrypted", async () => {
    const { impl } = fakeFetch();
    await expect(
      peerFetch(makePeer({ encryptedApiKey: "not-valid-ciphertext" }), "/x", {}, impl),
    ).rejects.toThrow(/cannot be decrypted/);
  });
});

describe("readPeerJson", () => {
  it("returns parsed JSON on a 2xx JSON response", async () => {
    const res = Response.json({ version: 1, appVersion: "0.3.18" });
    await expect(readPeerJson(res, "capabilities")).resolves.toEqual({
      version: 1,
      appVersion: "0.3.18",
    });
  });

  it("maps a 3xx redirect to a Cloudflare-Access hint", async () => {
    const res = new Response(null, { status: 302, headers: { location: "/login" } });
    await expect(readPeerJson(res, "capabilities")).rejects.toThrow(
      /unexpected redirect \(HTTP 302\).*Cloudflare Access/,
    );
  });

  it("maps an opaqueredirect Response type to the same hint", async () => {
    // Node's manual-redirect fetch can yield an opaqueredirect (status 0).
    const res = { type: "opaqueredirect", status: 0 } as unknown as Response;
    await expect(readPeerJson(res, "capabilities")).rejects.toThrow(/unexpected redirect/);
  });

  it("maps 401 to a 'rejected the API key' message", async () => {
    const res = new Response("Unauthorized", { status: 401 });
    await expect(readPeerJson(res, "capabilities")).rejects.toThrow(
      /rejected the API key \(401\)/,
    );
  });

  it("maps 404 to a 'Base URL includes the instance path prefix' message", async () => {
    const res = new Response("Not Found", { status: 404 });
    await expect(readPeerJson(res, "capabilities")).rejects.toThrow(
      /not found \(404\).*instance path prefix/,
    );
  });

  it("includes the status and a body snippet for other non-2xx responses", async () => {
    const res = new Response("kaboom internal", { status: 500 });
    await expect(readPeerJson(res, "DB bundle import")).rejects.toThrow(
      /DB bundle import: destination returned HTTP 500 — kaboom internal/,
    );
  });

  it("flags a 2xx non-JSON (HTML login page) response", async () => {
    const res = new Response("<!doctype html><title>Login</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await expect(readPeerJson(res, "capabilities")).rejects.toThrow(
      /expected JSON but got text\/html.*login page/,
    );
  });
});
