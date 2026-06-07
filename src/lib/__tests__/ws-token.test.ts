// @vitest-environment node
/**
 * Tests for `src/lib/ws-token.ts` — the HMAC mint/verify for the two WebSocket
 * token KINDS (session vs proxy) introduced for remote-dev-kn0q.
 *
 * Focus: the accept/reject matrix that keeps the two kinds non-interchangeable
 * and binds proxy tokens to a single port, plus backward-compat for the legacy
 * session token used by terminal auth.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  generateWsToken,
  validateWsToken,
  generateProxyWsToken,
  validateProxyWsToken,
  CONTROL_SESSION_SENTINEL,
} from "../ws-token";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  // Setting AUTH_SECRET keeps `getAuthSecret` out of the production-guard branch
  // (it only throws when the secret is UNSET), so NODE_ENV needs no juggling.
  process.env.AUTH_SECRET = "test-secret-for-ws-tokens";
  vi.useRealTimers();
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  vi.useRealTimers();
});

describe("session tokens (backward compat)", () => {
  it("round-trips a session token", () => {
    const token = generateWsToken("sess-123", "user-abc");
    expect(validateWsToken(token)).toEqual({
      sessionId: "sess-123",
      userId: "user-abc",
    });
  });

  it("rejects a tampered session token", () => {
    const token = generateWsToken("sess-123", "user-abc");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    // Flip the userId but keep the original HMAC → must fail.
    const parts = decoded.split(":");
    parts[1] = "attacker";
    const forged = Buffer.from(parts.join(":")).toString("base64");
    expect(validateWsToken(forged)).toBeNull();
  });

  it("rejects an expired session token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const token = generateWsToken("sess-123", "user-abc");
    // Advance past the 5-minute TTL.
    vi.setSystemTime(new Date("2030-01-01T00:06:00Z"));
    expect(validateWsToken(token)).toBeNull();
  });

  it("rejects garbage / malformed tokens", () => {
    expect(validateWsToken("")).toBeNull();
    expect(validateWsToken("not-base64-!!!")).toBeNull();
    expect(
      validateWsToken(Buffer.from("only:three:parts").toString("base64")),
    ).toBeNull();
  });
});

describe("control-mode tokens (remote-dev-d5ci)", () => {
  it("round-trips a control token carrying the sentinel sessionId", () => {
    // The /api/control-token route mints generateWsToken(CONTROL_SESSION_SENTINEL, userId);
    // the terminal server accepts ?control=1 only when the token's sessionId
    // equals the sentinel.
    const token = generateWsToken(CONTROL_SESSION_SENTINEL, "user-abc");
    expect(validateWsToken(token)).toEqual({
      sessionId: CONTROL_SESSION_SENTINEL,
      userId: "user-abc",
    });
  });

  it("a forged control token (wrong secret) is rejected", () => {
    const token = generateWsToken(CONTROL_SESSION_SENTINEL, "user-abc");
    process.env.AUTH_SECRET = "a-totally-different-secret";
    expect(validateWsToken(token)).toBeNull();
  });
});

describe("proxy tokens — accept", () => {
  it("round-trips a proxy token bound to the same port", () => {
    const token = generateProxyWsToken("user-abc", 6000);
    expect(validateProxyWsToken(token, 6000)).toEqual({
      userId: "user-abc",
      port: 6000,
    });
  });
});

describe("proxy tokens — reject matrix", () => {
  it("rejects a proxy token presented for a DIFFERENT port", () => {
    const token = generateProxyWsToken("user-abc", 6000);
    expect(validateProxyWsToken(token, 6001)).toBeNull();
  });

  it("rejects an expired proxy token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const token = generateProxyWsToken("user-abc", 6000);
    vi.setSystemTime(new Date("2030-01-01T00:06:00Z"));
    expect(validateProxyWsToken(token, 6000)).toBeNull();
  });

  it("rejects a tampered proxy token (forged port keeps old HMAC)", () => {
    const token = generateProxyWsToken("user-abc", 6000);
    const parts = Buffer.from(token, "base64").toString("utf8").split(":");
    // parts = [proxy, user, port, ts, hmac]; bump the port but keep the HMAC.
    parts[2] = "7000";
    const forged = Buffer.from(parts.join(":")).toString("base64");
    expect(validateProxyWsToken(forged, 7000)).toBeNull();
  });

  it("rejects a proxy token signed with a different secret", () => {
    const token = generateProxyWsToken("user-abc", 6000);
    process.env.AUTH_SECRET = "a-totally-different-secret";
    expect(validateProxyWsToken(token, 6000)).toBeNull();
  });
});

describe("cross-kind isolation", () => {
  it("a SESSION token is NOT accepted by the proxy validator", () => {
    const sessionToken = generateWsToken("sess-123", "user-abc");
    expect(validateProxyWsToken(sessionToken, 6000)).toBeNull();
  });

  it("a PROXY token is NOT accepted by the session validator", () => {
    const proxyToken = generateProxyWsToken("user-abc", 6000);
    expect(validateWsToken(proxyToken)).toBeNull();
  });

  it("a 4-part token whose first field is literally 'proxy' is rejected as a session token", () => {
    // Defense-in-depth: even a correctly-HMAC'd 4-part token can't pose as a
    // session token if its sessionId is the reserved kind marker.
    const secret = process.env.AUTH_SECRET as string;
    const ts = Date.now();
    const data = `proxy:user-abc:${ts}`;
    const hmac = createHmac("sha256", secret).update(data).digest("hex");
    const token = Buffer.from(`${data}:${hmac}`).toString("base64");
    expect(validateWsToken(token)).toBeNull();
  });
});
