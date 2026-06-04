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
import { validateProxyWsToken } from "../lib/ws-token.js";
import { isPortProxyable } from "../lib/proxy-port-utils.js";
import { BASE_PATH } from "../lib/base-path.js";
import { resolveExternalOrigin } from "../lib/request-origin.js";
import { createLogger } from "../lib/logger.js";

const proxyLog = createLogger("PortProxyWs");

/** How long to wait for the upstream (in-pod dev server) WS to open (ms). */
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Max client→upstream frames buffered before the upstream WS opens (DoS bound).
 * Mirrors the supervisor router's `MAX_PENDING` (`apps/supervisor-router/src/lib/
 * proxy.ts`) so a client can't buffer unbounded data pre-open.
 */
const MAX_PENDING = 512;

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

/** Collapse a Node header (`string | string[] | undefined`) to its first value. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Validate the WebSocket `Origin` against this instance's public origin
 * (remote-dev-kn0q). The port-proxy WS is a BROWSER-only feature (HMR / live
 * reload from the proxied iframe), and browsers ALWAYS send an `Origin` on the
 * WS handshake — so a missing or cross-origin `Origin` is rejected. This blocks a
 * leaked token being driven from an attacker page on another origin.
 *
 * The allowed origin is derived the same way the rest of the app derives its
 * public origin: the edge-forwarded `x-forwarded-host` / `host` (the router and
 * cloudflared set these to the real public host), with `AUTH_URL` as the
 * fallback. Both sides are normalized through `new URL(...).origin` (scheme +
 * host + port, never a trailing slash) before comparison.
 *
 * @param origin - The raw `Origin` header from the upgrade request (may be absent).
 * @param getHeader - Accessor for the upgrade request's headers.
 * @returns true iff `origin` is present and matches the instance's public origin.
 */
export function isAllowedProxyOrigin(
  origin: string | undefined,
  getHeader: (name: string) => string | undefined,
): boolean {
  if (!origin) return false;

  let originValue: string;
  try {
    originValue = new URL(origin).origin;
  } catch {
    // Not a parseable absolute origin (e.g. "null", "" or garbage) → reject.
    return false;
  }

  const allowed = new Set<string>();

  // Edge-forwarded public host (router/cloudflared/Traefik set this). Fallback
  // origin is irrelevant here because we only keep entries we can fully parse.
  const external = resolveExternalOrigin(
    (name) => getHeader(name) ?? null,
    "",
  );
  if (external) {
    try {
      allowed.add(new URL(external).origin);
    } catch {
      // ignore an unparseable derived origin
    }
  }

  // AUTH_URL is the canonical public base for single-server / localhost deploys
  // (where there is no edge `x-forwarded-host`).
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  if (authUrl) {
    try {
      allowed.add(new URL(authUrl).origin);
    } catch {
      // ignore a malformed AUTH_URL
    }
  }

  return allowed.has(originValue);
}

/**
 * Handle an accepted port-proxy WebSocket connection (emitted by the dedicated
 * `proxyWss` in `terminal.ts`, NEVER the terminal-session `wss`).
 *
 * Defense-in-depth gates (remote-dev-kn0q + remote-dev-urjg), in order:
 *   1. Parse the path → target `port` (needed to verify the port-bound token).
 *   2. `Origin` allowlist — the WS must come from this instance's public origin
 *      ({@link isAllowedProxyOrigin}); a leaked token can't be driven cross-origin.
 *   3. Authenticate via `?token=` → {@link validateProxyWsToken}, which requires
 *      a `kind:"proxy"` token BOUND to this exact `port` (a terminal-session
 *      token is rejected here, and vice-versa).
 *   4. Syntactic port gate via `isPortProxyable` (privileged / hard-blocked).
 *   5. Runtime membership — the port must be in the token owner's live
 *      `(listening ∪ claimed)` set ({@link isPortProxyableForUser}).
 *   6. Open an upstream `ws://127.0.0.1:<port><upstreamPath><query-minus-token>`
 *      and bridge both directions faithfully (text + binary), propagating close.
 *
 * Close codes match the terminal handler's convention: 4001 (auth required),
 * 4002 (invalid/expired/wrong-kind/wrong-port token); plus 1008 (policy — bad
 * origin / bad port / not in proxyable set) and 1011 (internal — upstream
 * connect/error). Client→upstream frames are buffered (bounded by
 * {@link MAX_PENDING}) until the upstream opens.
 */
export function handleProxyWsUpgrade(
  clientWs: WebSocket,
  req: IncomingMessage,
): void {
  // `req.url` is the path the router forwarded UNCHANGED, e.g.
  // `/alpha/proxy/6000/_hmr?token=…`. Parse against a dummy base for the query.
  const reqUrl = new URL(req.url || "", "http://127.0.0.1");
  const pathOnly = reqUrl.pathname;

  // 1. Parse + syntactically gate the port FIRST — we need it to verify the
  //    port-bound proxy token below.
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

  // 2. Origin allowlist. Browsers always send an Origin on the WS handshake, so
  //    a missing/cross-origin value is a non-browser or cross-site caller.
  const origin = firstHeader(req.headers.origin);
  if (!isAllowedProxyOrigin(origin, (name) => firstHeader(req.headers[name]))) {
    proxyLog.warn("Rejected proxy WS with disallowed Origin", {
      port,
      origin: origin ?? null,
    });
    clientWs.close(1008, "Origin not allowed");
    return;
  }

  // 3. Authenticate with a PROXY-kind token BOUND to this port. A terminal
  //    session token (or a proxy token minted for a different port) is rejected.
  const token = reqUrl.searchParams.get("token");
  if (!token) {
    clientWs.close(4001, "Authentication required");
    return;
  }
  const authResult = validateProxyWsToken(token, port);
  if (!authResult) {
    clientWs.close(4002, "Invalid or expired token");
    return;
  }
  const { userId } = authResult;

  // 4 (build) + 5 (runtime membership). The membership check is async (DB +
  // `lsof`); the client handshake is already complete, so we hold the socket,
  // run the check, then either bridge or close. Errors fail CLOSED.
  void (async () => {
    let allowed: boolean;
    try {
      // Dynamic import keeps the DB/`lsof`-backed membership service OUT of this
      // module's static graph (so the pure path/origin helpers stay importable
      // without DB side effects) — mirrors how `terminal.ts` loads services.
      const { isPortProxyableForUser } = await import(
        "../services/proxyable-ports-service.js"
      );
      allowed = await isPortProxyableForUser(userId, port);
    } catch (error) {
      proxyLog.warn("Proxy WS membership check failed", {
        error: String(error),
        port,
        userId,
      });
      clientWs.close(1011, "membership check failed");
      return;
    }
    if (!allowed) {
      proxyLog.warn("Rejected proxy WS port not in user's proxyable set", {
        port,
        userId,
      });
      clientWs.close(1008, "Port not in your proxyable set");
      return;
    }
    connectAndBridge();
  })();

  // 6. Build the upstream URL: ws://127.0.0.1:<port> + upstreamPath + the
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

  /**
   * Open the upstream socket and wire both directions. Deferred until the async
   * membership gate above resolves OK (the client handshake is already done).
   */
  function connectAndBridge(): void {
    // The client may have gone away during the async membership check; if so,
    // don't bother opening an upstream that would only dangle until timeout.
    if (
      clientWs.readyState === WebSocket.CLOSING ||
      clientWs.readyState === WebSocket.CLOSED
    ) {
      return;
    }

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

    /**
     * Close BOTH sockets once, swallowing errors. `clientCode` defaults to the
     * upstream `code` but can differ — e.g. a policy violation closes the client
     * with 1008 while the upstream is torn down with 1011.
     */
    function teardown(code: number, reason: string, clientCode = code): void {
      if (closing) return;
      closing = true;
      clearTimeout(connectTimer);
      pending.length = 0;
      try {
        upstream.close(normalizeProxyCloseCode(code), reason);
      } catch {
        // already closing/closed
      }
      try {
        clientWs.close(normalizeProxyCloseCode(clientCode), reason);
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
      // Drop any buffered pre-open frames so they can be GC'd (mirrors teardown()).
      pending.length = 0;
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
        return;
      }
      // Upstream not open yet — buffer until its `open` fires, but BOUND the
      // queue (mirrors the router's MAX_PENDING) so a client streaming at a
      // stalled upstream can't grow memory without limit. Close the CLIENT with
      // 1008 (policy), matching the router; the upstream gets 1011.
      if (pending.length >= MAX_PENDING) {
        proxyLog.warn("Proxy WS pre-open buffer overflow; closing", {
          port,
          max: MAX_PENDING,
        });
        teardown(1011, "buffer overflow before upstream open", 1008);
        return;
      }
      pending.push({ data, isBinary });
    });

    clientWs.on("close", (code: number, reason: Buffer) => {
      if (closing) return;
      closing = true;
      clearTimeout(connectTimer);
      // Drop any buffered pre-open frames so they can be GC'd (mirrors teardown()).
      pending.length = 0;
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
}
