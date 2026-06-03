/**
 * In-pod port-proxy WebSocket bridge (plan §6 B3, remote-dev-4oyg).
 *
 * The k3s Supervisor router forwards `/<slug>/proxy/<port>/…` WebSocket UPGRADES
 * to this instance's terminal server (`:6002`) UNCHANGED (see
 * `apps/supervisor-router/src/lib/router-core.ts`). This module accepts those
 * upgrades and bridges the socket to the in-pod dev server listening on
 * `ws://127.0.0.1:<port>/…` — enabling HMR / live-reload through the proxy.
 *
 * HTTP for the same paths already works (B1 — `src/app/proxy/[port]/[...path]`)
 * and needs no change; only the WebSocket upgrade lands here.
 *
 * The bridge logic mirrors the router's Bun bridge
 * (`apps/supervisor-router/src/lib/proxy.ts`) but is ADAPTED to the Node `ws`
 * library the terminal server uses (the router uses Bun's `ServerWebSocket`).
 */

import { WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import { validateWsToken } from "../lib/ws-token.js";
import { isPortProxyable } from "../lib/proxy-port-utils.js";
import { BASE_PATH } from "../lib/base-path.js";
import { createLogger } from "../lib/logger.js";

const proxyLog = createLogger("PortProxyWs");

/** How long to wait for the upstream (in-pod dev server) WS to open (ms). */
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Matches a port-proxy WebSocket path and captures the target port.
 *
 * The browser-facing path is `<basePath>/proxy/<port>/…` where `<basePath>` is
 * this instance's `RDV_BASE_PATH` — the SAME source the terminal WebSocket
 * (`WS_PATH_PREFIX = <basePath>/ws`) derives from. When `BASE_PATH` is empty the
 * pattern is `^/proxy/(\d+)(?:/|$)`; with `BASE_PATH=/alpha` it is
 * `^/alpha/proxy/(\d+)(?:/|$)`.
 *
 * `BASE_PATH` is already validated (`^(\/[a-z0-9][a-z0-9-]*)+$` in base-path.ts)
 * so it is safe to interpolate into the RegExp without escaping.
 */
export const PROXY_WS_PATH_PATTERN = new RegExp(
  `^${BASE_PATH}/proxy/(\\d+)(?:/|$)`,
);

/** Result of parsing a port-proxy WS path. */
export interface ParsedProxyWsPath {
  /** The target port (integer; NOT yet validated against {@link isPortProxyable}). */
  port: number;
  /**
   * The path to forward to the in-pod dev server, with the
   * `<basePath>/proxy/<port>` prefix STRIPPED. Always starts with `/` and
   * defaults to `/` when the proxied path had no trailing segment.
   */
  upstreamPath: string;
}

/**
 * Parse a port-proxy WS path (the part before any `?query`).
 *
 * Returns `null` if `pathOnly` is not a port-proxy path. On a match, strips the
 * `<basePath>/proxy/<port>` prefix to produce the path to forward upstream:
 *
 *   BASE_PATH="/alpha", "/alpha/proxy/6000/_hmr" → { port: 6000, upstreamPath: "/_hmr" }
 *   BASE_PATH="/alpha", "/alpha/proxy/6000"       → { port: 6000, upstreamPath: "/" }
 *   BASE_PATH="",       "/proxy/6000/ws"          → { port: 6000, upstreamPath: "/ws" }
 */
export function parseProxyWsPath(pathOnly: string): ParsedProxyWsPath | null {
  const match = PROXY_WS_PATH_PATTERN.exec(pathOnly);
  if (!match) return null;
  const port = Number(match[1]);
  // The matched prefix is `<basePath>/proxy/<port>`; everything after it is the
  // upstream path. `<port>` here is the literal digits the client sent.
  const prefix = `${BASE_PATH}/proxy/${match[1]}`;
  const rest = pathOnly.slice(prefix.length);
  const upstreamPath = rest === "" ? "/" : rest;
  return { port, upstreamPath };
}

/**
 * Map a close code to one that is valid to pass to `WebSocket.close()`.
 *
 * Per RFC 6455 §7.4, codes 1004, 1005, 1006 and 1012–1015 are reserved and must
 * NOT be sent by an endpoint (1005/1006 are synthesized locally on abnormal/
 * no-status closes). We preserve every code an endpoint legitimately sends —
 * 1000–1003, 1007–1011, and the 3000–4999 application range — and map only the
 * reserved/internal codes (and anything out of 1000–4999) to 1011. Mirrors
 * `normalizeCloseCode` in the router's `proxy.ts`.
 */
export function normalizeProxyCloseCode(code: number): number {
  if (code >= 1000 && code <= 1003) return code;
  if (code >= 1007 && code <= 1011) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}

/**
 * Handle an accepted port-proxy WebSocket connection (emitted by the dedicated
 * `proxyWss` in `terminal.ts`, NEVER the terminal-session `wss`).
 *
 * Steps:
 *   1. Authenticate via `?token=` → `validateWsToken` (HMAC).
 *      AUTH CAVEAT (5-min TTL): we reuse the session ws-token per the B3 plan.
 *      `validateWsToken` rejects tokens older than 5 minutes, so an HMR socket
 *      that the dev server opens >5 min after page load can 401 here. A
 *      longer-TTL / `kind:"proxy"` token is DEFERRED to B4 — see the report.
 *   2. Re-derive + syntactically gate the port via `isPortProxyable`.
 *   3. Open an upstream `ws://127.0.0.1:<port><upstreamPath><query-minus-token>`
 *      and bridge both directions faithfully (text + binary), propagating close.
 *
 * Close codes match the terminal handler's convention: 4001 (auth required),
 * 4002 (invalid/expired token); plus 1008 (policy — bad port) and 1011
 * (internal — upstream connect/error).
 */
export function handleProxyWsUpgrade(
  clientWs: WebSocket,
  req: IncomingMessage,
): void {
  // `req.url` is the path the router forwarded UNCHANGED, e.g.
  // `/alpha/proxy/6000/_hmr?token=…`. Parse against a dummy base for the query.
  const reqUrl = new URL(req.url || "", "http://127.0.0.1");
  const pathOnly = reqUrl.pathname;

  // 1. Authenticate. Mirror the terminal handler's codes/messages.
  const token = reqUrl.searchParams.get("token");
  if (!token) {
    clientWs.close(4001, "Authentication required");
    return;
  }
  const authResult = validateWsToken(token);
  if (!authResult) {
    // NOTE (5-min TTL): a late-opening HMR socket can land here even with a
    // token that was valid at page load. B4 hardens this with a longer-TTL
    // proxy-scoped token.
    clientWs.close(4002, "Invalid or expired token");
    return;
  }

  // 2. Parse + gate the port.
  const parsed = parseProxyWsPath(pathOnly);
  if (!parsed) {
    // Shouldn't happen — the upgrade gate in terminal.ts only routes matching
    // paths here — but be defensive.
    proxyLog.warn("Proxy WS path did not parse", { path: pathOnly });
    clientWs.close(1008, "Invalid proxy path");
    return;
  }
  const { port, upstreamPath } = parsed;
  if (!isPortProxyable(port)) {
    proxyLog.warn("Rejected non-proxyable port", { port });
    clientWs.close(1008, "Port not proxyable");
    return;
  }

  // 3. Build the upstream URL: ws://127.0.0.1:<port> + upstreamPath + the
  //    original query MINUS our `token` param (don't leak the auth token to the
  //    in-pod dev server).
  reqUrl.searchParams.delete("token");
  const upstreamSearch = reqUrl.searchParams.toString();
  const upstreamUrl = `ws://127.0.0.1:${port}${upstreamPath}${
    upstreamSearch ? `?${upstreamSearch}` : ""
  }`;

  // Forward the requested subprotocol(s) so the upstream can negotiate them.
  const protocolHeader = req.headers["sec-websocket-protocol"];
  const protocols =
    typeof protocolHeader === "string"
      ? protocolHeader
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

  let upstream: WebSocket;
  try {
    upstream =
      protocols.length > 0
        ? new WebSocket(upstreamUrl, protocols)
        : new WebSocket(upstreamUrl);
  } catch (error) {
    proxyLog.warn("Failed to open upstream proxy WebSocket", {
      error: String(error),
      port,
    });
    clientWs.close(1011, "upstream connect failed");
    return;
  }

  // Bridge state. `pending` buffers client→upstream frames sent before the
  // upstream socket finishes opening (HMR clients usually wait for the server,
  // but a frame can race the open).
  let upstreamOpen = false;
  let closing = false;
  const pending: Array<{ data: RawData; isBinary: boolean }> = [];

  const connectTimer = setTimeout(() => {
    if (!upstreamOpen && !closing) {
      proxyLog.warn("Upstream proxy WebSocket connect timeout", { port });
      teardown(1011, "upstream connect timeout");
    }
  }, UPSTREAM_CONNECT_TIMEOUT_MS);

  /** Close BOTH sockets once, swallowing errors. */
  function teardown(code: number, reason: string): void {
    if (closing) return;
    closing = true;
    clearTimeout(connectTimer);
    pending.length = 0;
    const safe = normalizeProxyCloseCode(code);
    try {
      upstream.close(safe, reason);
    } catch {
      // already closing/closed
    }
    try {
      clientWs.close(safe, reason);
    } catch {
      // already closing/closed
    }
  }

  // --- upstream → client ---
  upstream.on("open", () => {
    upstreamOpen = true;
    clearTimeout(connectTimer);
    for (const { data, isBinary } of pending) {
      upstream.send(data, { binary: isBinary });
    }
    pending.length = 0;
    proxyLog.debug("Port-proxy WS bridge open", { port });
  });

  upstream.on("message", (data: RawData, isBinary: boolean) => {
    if (closing) return;
    clientWs.send(data, { binary: isBinary });
  });

  upstream.on("close", (code: number, reason: Buffer) => {
    if (closing) return;
    closing = true;
    clearTimeout(connectTimer);
    try {
      clientWs.close(normalizeProxyCloseCode(code), reason.toString());
    } catch {
      // already closing/closed
    }
  });

  upstream.on("error", (error: Error) => {
    proxyLog.warn("Upstream proxy WebSocket error", {
      error: String(error),
      port,
    });
    teardown(1011, "upstream error");
  });

  // --- client → upstream ---
  clientWs.on("message", (data: RawData, isBinary: boolean) => {
    if (closing) return;
    if (upstreamOpen) {
      upstream.send(data, { binary: isBinary });
    } else {
      pending.push({ data, isBinary });
    }
  });

  clientWs.on("close", (code: number, reason: Buffer) => {
    if (closing) return;
    closing = true;
    clearTimeout(connectTimer);
    try {
      upstream.close(normalizeProxyCloseCode(code), reason.toString());
    } catch {
      // already closing/closed
    }
  });

  clientWs.on("error", (error: Error) => {
    proxyLog.warn("Client proxy WebSocket error", {
      error: String(error),
      port,
    });
    teardown(1011, "client error");
  });
}
