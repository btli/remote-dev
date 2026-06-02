/**
 * HTTP + WebSocket proxying for the Supervisor router (spec §5, §15 M5).
 *
 * - HTTP: `fetch` the upstream with the SAME method/headers/body/path/query,
 *   `redirect: "manual"` (the router never follows redirects on the client's
 *   behalf), and return the upstream Response — stripping `Content-Encoding`
 *   and `Content-Length` when the upstream compressed, because the fetch impl
 *   auto-decompresses the body so those framing headers no longer describe it.
 * - WebSocket: bridge a Bun `ServerWebSocket` (client side) to an upstream
 *   `new WebSocket(url, { headers })` (instance side). Client→upstream messages
 *   are buffered until the upstream socket opens; both directions are then piped
 *   and close/error is propagated either way.
 *
 * Auth is NOT terminated here: the `Cookie` header (carrying `CF_Authorization`)
 * and `Cf-Access-Jwt-Assertion` are forwarded UNCHANGED — each instance
 * validates Cloudflare Access itself. Auth tokens are never logged.
 */

import type { Server, ServerWebSocket } from "bun";
import { createLogger } from "@/lib/logger";

const log = createLogger("Proxy");

/** Max client→upstream messages buffered before the upstream WS opens (DoS bound). */
const MAX_PENDING = 512;
/** How long to wait for the upstream WS to open before giving up (ms). */
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Hop-by-hop headers (RFC 7230 §6.1) that must NOT be forwarded by a proxy.
 * Note `Cookie`, `Cf-Access-Jwt-Assertion`, and `Authorization` are NOT here —
 * they carry the end-user's auth and are forwarded untouched.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Per-connection state stored on `ws.data` for a proxied WebSocket. */
export interface WsProxyData {
  /** Full upstream ws URL, e.g. `ws://rdv.rdv-alpha.svc.cluster.local:6002/alpha/ws`. */
  upstreamWsUrl: string;
  /** Headers to replay on the upstream upgrade (cookies / CF Access / WS proto). */
  headers: Record<string, string>;
  /** The slug, for logging. */
  slug: string;
}

/** Mutable runtime state attached to each bridged connection. */
interface BridgeState {
  upstream: WebSocket | null;
  upstreamOpen: boolean;
  /** Messages from the client buffered until the upstream socket opens (bounded). */
  pending: (string | Uint8Array)[];
  closedByClient: boolean;
  /** Whether the client socket has closed (no more buffering once true). */
  clientClosed: boolean;
  /** Fires if the upstream WS doesn't open within the connect deadline. */
  connectTimer: ReturnType<typeof setTimeout> | null;
}

const bridges = new WeakMap<ServerWebSocket<WsProxyData>, BridgeState>();

/**
 * Build the headers to forward on the HTTP proxy request: copy everything,
 * drop hop-by-hop, and DROP the client `Host` so the fetch impl sets `Host` to
 * the upstream authority (forwarding the public host as `Host` would confuse
 * the instance's own host checks). The public origin is instead conveyed via
 * `X-Forwarded-Host`/`-Proto`/`-For` so the instance can still build correct
 * absolute URLs. `Cookie`/`Cf-Access-Jwt-Assertion` are forwarded unchanged —
 * the instance still validates Cloudflare Access itself.
 */
function forwardHttpHeaders(req: Request, clientIp: string | null): Headers {
  const out = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "host") return; // let the upstream authority own Host
    out.set(key, value);
  });

  // Forwarding context (public origin) for the instance.
  const incomingHost = req.headers.get("host");
  if (incomingHost) out.set("x-forwarded-host", incomingHost);

  const incomingProto = req.headers.get("x-forwarded-proto");
  out.set("x-forwarded-proto", incomingProto ?? "https");

  // Append the client IP to the X-Forwarded-For chain.
  if (clientIp) {
    const existing = req.headers.get("x-forwarded-for");
    out.set("x-forwarded-for", existing ? `${existing}, ${clientIp}` : clientIp);
  }

  return out;
}

/**
 * Proxy an HTTP request to `upstreamBase` + `path` + the original query string.
 * Returns the upstream Response (streamed through), or a 502 if the upstream is
 * unreachable. When the upstream response carries a `Content-Encoding`, that
 * header and `Content-Length` are stripped before returning: the fetch impl
 * already decompressed the body, so the originals would mislead the client into
 * decoding plaintext (ZlibError / corruption).
 *
 * `server` (the Bun.serve instance) is threaded through only to resolve the
 * peer IP for `X-Forwarded-For`; it's optional so unit tests can omit it.
 */
export async function proxyHttp(
  req: Request,
  upstreamBase: string,
  path: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  server?: Pick<Server<unknown>, "requestIP">,
): Promise<Response> {
  const search = new URL(req.url).search; // includes leading "?" or ""
  const target = `${upstreamBase}${path}${search}`;

  const clientIp = server?.requestIP(req)?.address ?? null;
  const init: RequestInit = {
    method: req.method,
    headers: forwardHttpHeaders(req, clientIp),
    redirect: "manual",
  };
  // GET/HEAD must not carry a body; everything else streams the request body.
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // Required by undici/fetch when streaming a ReadableStream body.
    (init as { duplex?: "half" }).duplex = "half";
  }

  try {
    const upstream = await fetchImpl(target, init);
    // Bun's fetch auto-decompresses the body but leaves the upstream
    // Content-Encoding (and a now-stale Content-Length) on the headers.
    // Returning that unchanged makes the client try to decode an
    // already-decoded body (ZlibError / corruption). When an encoding is
    // present, strip both framing headers and re-stream the identity body;
    // Bun re-frames it (chunked). Uncompressed responses are returned as-is so
    // their accurate Content-Length is preserved.
    if (upstream.headers.has("content-encoding")) {
      const headers = new Headers(upstream.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }
    return upstream;
  } catch (error) {
    log.warn("Upstream HTTP request failed", {
      error: String(error),
      // target intentionally omitted at warn for brevity; debug has it.
    });
    log.debug("Upstream HTTP target", { target });
    return new Response("Bad Gateway", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Open the upstream WebSocket for a freshly-accepted client connection and wire
 * bidirectional piping. Call from the `Bun.serve` `websocket.open` handler.
 */
export function openWsBridge(ws: ServerWebSocket<WsProxyData>): void {
  const { upstreamWsUrl, headers, slug } = ws.data;

  let upstream: WebSocket;
  try {
    upstream = new WebSocket(upstreamWsUrl, { headers });
  } catch (error) {
    // Synchronous construct failure: never register a bridge for this socket
    // (so no later handler can touch a half-built state), then close.
    log.warn("Failed to open upstream WebSocket", {
      error: String(error),
      slug,
    });
    bridges.delete(ws);
    ws.close(1011, "upstream connect failed");
    return;
  }
  upstream.binaryType = "arraybuffer";

  const state: BridgeState = {
    upstream,
    upstreamOpen: false,
    pending: [],
    closedByClient: false,
    clientClosed: false,
    connectTimer: null,
  };
  bridges.set(ws, state);

  // Connect deadline: if the upstream never opens, don't hang (or buffer)
  // forever — close both sides.
  state.connectTimer = setTimeout(() => {
    if (!state.upstreamOpen && !state.closedByClient) {
      log.warn("Upstream WebSocket connect timeout", { slug });
      teardownUpstream(state, 1011, "upstream connect timeout");
      ws.close(1011, "upstream connect timeout");
    }
  }, UPSTREAM_CONNECT_TIMEOUT_MS);

  upstream.addEventListener("open", () => {
    state.upstreamOpen = true;
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
      state.connectTimer = null;
    }
    // Flush anything the client sent before the upstream was ready.
    for (const msg of state.pending) {
      upstream.send(msg);
    }
    state.pending.length = 0;
    log.debug("WS bridge open", { slug });
  });

  upstream.addEventListener("message", (event: MessageEvent) => {
    // upstream → client
    const data = event.data;
    if (typeof data === "string") {
      ws.send(data);
    } else if (data instanceof ArrayBuffer) {
      ws.send(new Uint8Array(data));
    } else {
      // Blob/other — coerce defensively (Bun typically gives ArrayBuffer/string).
      ws.send(String(data));
    }
  });

  upstream.addEventListener("close", (event: CloseEvent) => {
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
      state.connectTimer = null;
    }
    if (!state.closedByClient) {
      ws.close(normalizeCloseCode(event.code), event.reason);
    }
  });

  upstream.addEventListener("error", () => {
    log.warn("Upstream WebSocket error", { slug });
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
      state.connectTimer = null;
    }
    if (!state.closedByClient) {
      ws.close(1011, "upstream error");
    }
  });
}

/** Close the upstream socket + clear the connect timer, swallowing errors. */
function teardownUpstream(
  state: BridgeState,
  code: number,
  reason: string,
): void {
  if (state.connectTimer) {
    clearTimeout(state.connectTimer);
    state.connectTimer = null;
  }
  state.pending.length = 0;
  if (state.upstream) {
    try {
      state.upstream.close(normalizeCloseCode(code), reason);
    } catch {
      // Already closing/closed — ignore.
    }
  }
}

/** Forward a client→upstream message (from the `websocket.message` handler). */
export function forwardWsMessage(
  ws: ServerWebSocket<WsProxyData>,
  message: string | Buffer,
): void {
  const state = bridges.get(ws);
  if (!state || state.clientClosed) return;
  const payload: string | Uint8Array =
    typeof message === "string" ? message : new Uint8Array(message);
  if (state.upstream && state.upstreamOpen) {
    state.upstream.send(payload);
    return;
  }
  // Upstream not open yet — buffer until its `open` fires, but bound the queue
  // so a client streaming at a stalled/restarting instance can't grow memory
  // without limit.
  if (state.pending.length >= MAX_PENDING) {
    log.warn("WS pre-open buffer overflow; closing", {
      slug: ws.data.slug,
      max: MAX_PENDING,
    });
    teardownUpstream(state, 1011, "buffer overflow before upstream open");
    state.clientClosed = true;
    ws.close(1008, "buffer overflow before upstream open");
    bridges.delete(ws);
    return;
  }
  state.pending.push(payload);
}

/** Tear down the upstream when the client closes (from `websocket.close`). */
export function closeWsBridge(
  ws: ServerWebSocket<WsProxyData>,
  code: number,
  reason: string,
): void {
  const state = bridges.get(ws);
  if (!state) return;
  state.closedByClient = true;
  state.clientClosed = true;
  teardownUpstream(state, code, reason);
  bridges.delete(ws);
}

/**
 * Map a close code to one that is valid to pass to `WebSocket.close()`.
 *
 * Per RFC 6455 §7.4, codes 1004, 1005, 1006 and 1012–1015 are reserved and must
 * NOT be sent by an endpoint (1005/1006 in particular are synthesized locally on
 * abnormal/no-status closes). We preserve every code an endpoint legitimately
 * sends — 1000–1003, 1007–1011, and the 3000–4999 application range — so real
 * signals propagate, and map only the reserved/internal codes (and anything
 * outside 1000–4999) to 1011 (internal error).
 */
export function normalizeCloseCode(code: number): number {
  if (code >= 1000 && code <= 1003) return code;
  if (code >= 1007 && code <= 1011) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}

/**
 * Build the upstream upgrade headers from the incoming request: forward
 * cookies, CF Access, and the WebSocket negotiation headers UNCHANGED. Bun's
 * `WebSocket` client sets `Sec-WebSocket-Key`/`Version`/`Upgrade`/`Connection`
 * itself, so we only need to carry `Sec-WebSocket-Protocol`/`-Extensions` plus
 * auth and a few useful forwarding headers.
 */
export function buildWsUpgradeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const carry = [
    "cookie",
    "cf-access-jwt-assertion",
    "authorization",
    "sec-websocket-protocol",
    "sec-websocket-extensions",
    "user-agent",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
  ];
  for (const name of carry) {
    const value = req.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
