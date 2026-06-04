// @vitest-environment node
/**
 * Orchestration tests for `handleProxyWsUpgrade` (remote-dev-kn0q + urjg, M1).
 *
 * Drives the bridge with a mock `ws.WebSocket` (an EventEmitter exposing
 * `close`/`send`/`readyState` + the static readyState constants) and a mocked
 * `proxyable-ports-service`, asserting the close-code contract:
 *
 *   missing token            → 4001
 *   wrong-kind / expired /
 *     wrong-port token        → 4002
 *   non-member port           → 1008
 *   membership check THROWS   → 1011 (fail-closed)
 *   >MAX_PENDING pre-open      → teardown: upstream 1011, client 1008
 *
 * `BASE_PATH` is empty in tests, so the proxy path is `/proxy/<port>/…`.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";

// --- mock the membership service (the bridge dynamic-imports it) ---
// The bridge does `import("../services/proxyable-ports-service.js")` relative to
// `src/server/`; from THIS test file (`src/server/__tests__/`) the same module is
// `../../services/...`. vitest resolves both to one absolute id, so this mock
// intercepts the bridge's dynamic import.
const isPortProxyableForUser = vi.hoisted(() => vi.fn());
vi.mock("../../services/proxyable-ports-service.js", () => ({
  isPortProxyableForUser,
}));

// --- mock `ws` so constructing the upstream never opens a real socket ---
// The fake WebSocket carries the static readyState constants the bridge reads
// (`WebSocket.CLOSING` / `WebSocket.CLOSED`), `close`/`send` spies, and a minimal
// `on`/`emit` (NOT Node's EventEmitter — a hoisted factory runs before ESM
// imports initialize, so it must be self-contained). Instances created via
// `new WebSocket(url)` (the upstream) are captured in `upstreams`.
const { FakeWebSocket, upstreams } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const created: FakeWS[] = [];
  class FakeWS {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 1; // OPEN
    close = vi.fn();
    send = vi.fn();
    private listeners = new Map<string, Listener[]>();
    constructor(..._args: unknown[]) {
      created.push(this);
    }
    on(event: string, fn: Listener): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn);
      this.listeners.set(event, arr);
      return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
      const arr = this.listeners.get(event);
      if (!arr?.length) return false;
      for (const fn of [...arr]) fn(...args);
      return true;
    }
  }
  return { FakeWebSocket: FakeWS, upstreams: created };
});

vi.mock("ws", () => ({ WebSocket: FakeWebSocket }));

// Import AFTER the mocks are registered.
import { handleProxyWsUpgrade } from "../proxy-ws-bridge";
import { generateProxyWsToken, generateWsToken } from "../../lib/ws-token";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
const ORIGINAL_AUTH_URL = process.env.AUTH_URL;
const ORIGIN = "https://rdv.test";

/** Build a fake client `ws` (EventEmitter + close/send spies, OPEN). */
function makeClient(): EventEmitter & {
  close: Mock;
  send: Mock;
  readyState: number;
} {
  const ws = new EventEmitter() as EventEmitter & {
    close: Mock;
    send: Mock;
    readyState: number;
  };
  ws.close = vi.fn();
  ws.send = vi.fn();
  ws.readyState = FakeWebSocket.OPEN;
  return ws;
}

/** Build a minimal upgrade `IncomingMessage` for a proxy path. */
function makeReq(
  path: string,
  opts: { origin?: string | undefined } = {},
): IncomingMessage {
  const headers: Record<string, string | string[] | undefined> = {};
  if ("origin" in opts) headers.origin = opts.origin;
  else headers.origin = ORIGIN;
  return { url: path, headers } as unknown as IncomingMessage;
}

/** Let the bridge's async membership IIFE settle. */
async function flush(): Promise<void> {
  // Two macrotask hops cover: dynamic import resolution + the awaited check.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-bridge-handler";
  process.env.AUTH_URL = ORIGIN;
  isPortProxyableForUser.mockReset();
  upstreams.length = 0;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  vi.useRealTimers();
});

describe("handleProxyWsUpgrade — auth/gate close codes", () => {
  it("closes 4001 when no token is present", async () => {
    const client = makeClient();
    handleProxyWsUpgrade(client as never, makeReq("/proxy/6000/_hmr"));
    expect(client.close).toHaveBeenCalledWith(4001, "Authentication required");
    expect(isPortProxyableForUser).not.toHaveBeenCalled();
  });

  it("closes 4002 for a terminal-SESSION token (wrong kind)", async () => {
    const client = makeClient();
    const sessionToken = generateWsToken("sess-1", "user-1");
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${sessionToken}`),
    );
    expect(client.close).toHaveBeenCalledWith(4002, "Invalid or expired token");
    expect(isPortProxyableForUser).not.toHaveBeenCalled();
  });

  it("closes 4002 for a proxy token bound to a DIFFERENT port", async () => {
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 7000); // minted for 7000
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`), // presented for 6000
    );
    expect(client.close).toHaveBeenCalledWith(4002, "Invalid or expired token");
  });

  it("closes 4002 for an expired proxy token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const token = generateProxyWsToken("user-1", 6000);
    vi.setSystemTime(new Date("2030-01-01T00:06:00Z")); // past the 5-min TTL
    const client = makeClient();
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`),
    );
    expect(client.close).toHaveBeenCalledWith(4002, "Invalid or expired token");
  });

  it("closes 1008 for a disallowed Origin (before any token check)", async () => {
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`, {
        origin: "https://evil.example",
      }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, "Origin not allowed");
  });

  it("closes 1008 for a missing Origin (browsers always send one)", async () => {
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`, { origin: undefined }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, "Origin not allowed");
  });
});

describe("handleProxyWsUpgrade — runtime membership", () => {
  it("closes 1008 when the port is NOT in the user's proxyable set", async () => {
    isPortProxyableForUser.mockResolvedValue(false);
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`),
    );
    await flush();
    expect(isPortProxyableForUser).toHaveBeenCalledWith("user-1", 6000);
    expect(client.close).toHaveBeenCalledWith(
      1008,
      "Port not in your proxyable set",
    );
    // No upstream socket should have been opened.
    expect(upstreams).toHaveLength(0);
  });

  it("closes 1011 (fail-closed) when the membership check THROWS", async () => {
    isPortProxyableForUser.mockRejectedValue(new Error("db down"));
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`),
    );
    await flush();
    expect(client.close).toHaveBeenCalledWith(1011, "membership check failed");
    expect(upstreams).toHaveLength(0);
  });
});

describe("handleProxyWsUpgrade — pre-open buffer cap", () => {
  it("tears down (upstream 1011, client 1008) past MAX_PENDING pre-open frames", async () => {
    isPortProxyableForUser.mockResolvedValue(true);
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`),
    );
    await flush();

    // Membership passed → exactly one upstream opened, still CONNECTING (we
    // never emit its "open"), so client→upstream frames buffer.
    expect(upstreams).toHaveLength(1);
    const upstream = upstreams[0];

    // Push 513 frames before the upstream opens; the 513th trips the cap.
    for (let i = 0; i < 513; i++) {
      client.emit("message", Buffer.from(`f${i}`), true);
    }

    // Client closed with the policy code 1008; upstream torn down with 1011.
    expect(client.close).toHaveBeenCalledWith(
      1008,
      "buffer overflow before upstream open",
    );
    expect(upstream.close).toHaveBeenCalledWith(
      1011,
      "buffer overflow before upstream open",
    );
  });

  it("bridges normally when membership passes and stays under the cap", async () => {
    isPortProxyableForUser.mockResolvedValue(true);
    const client = makeClient();
    const token = generateProxyWsToken("user-1", 6000);
    handleProxyWsUpgrade(
      client as never,
      makeReq(`/proxy/6000/_hmr?token=${token}`),
    );
    await flush();
    expect(upstreams).toHaveLength(1);
    const upstream = upstreams[0];

    // A handful of pre-open frames buffer; on "open" they flush to the upstream.
    client.emit("message", Buffer.from("a"), true);
    client.emit("message", Buffer.from("b"), true);
    expect(client.close).not.toHaveBeenCalled();

    upstream.emit("open");
    expect(upstream.send).toHaveBeenCalledTimes(2);

    // After open, upstream→client messages pipe through.
    upstream.emit("message", Buffer.from("down"), true);
    expect(client.send).toHaveBeenCalledWith(Buffer.from("down"), {
      binary: true,
    });
  });
});
