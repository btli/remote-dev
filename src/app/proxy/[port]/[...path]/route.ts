/**
 * In-pod HTTP port proxy (plan §6 B1).
 *
 * Serves whatever is listening on `127.0.0.1:<port>` INSIDE this instance's pod,
 * at `<basePath>/proxy/<port>/<...path>`. The k3s router forwards
 * `https://rdv.joyful.house/<slug>/*` to this instance's Next.js app (`:6001`)
 * UNCHANGED; Next strips the `basePath=/<slug>` prefix, so this handler sees
 * `/proxy/<port>/<...path>`. We then `fetch` the loopback upstream (loopback
 * works even for localhost-bound dev servers, which a pod-IP proxy can't reach),
 * stream the response back, and rewrite redirect/cookie paths + inject a
 * `<base>` tag so a path-based-proxied app's relative URLs resolve correctly.
 *
 * Auth / owner-scoping: the request has already passed this instance's
 * CF-Access/session gate (`src/proxy.ts`), and `withAuth` requires a valid
 * session. The instance DB only ever contains users provisioned ONTO this
 * instance, so any authenticated caller is, by construction, an authorized
 * owner of the instance.
 *
 * The plan's OPTIONAL strict "requesting-email == instance-owner" check (§7) is
 * deliberately NOT implemented (assessed in B4, remote-dev-uqkk): there is no
 * clean single "instance owner" identity to enforce against. Instances are
 * seeded with a multi-value `AUTHORIZED_USERS` allow-list (→ the `authorized_user`
 * table), not one owner email; `withAuth` exposes only `userId` (no email)
 * here; and single-user/localhost (`RDV_BASE_PATH=""`) has no instance-owner
 * concept at all, so a strict email gate would risk breaking that case for zero
 * gain over the owner-by-construction model. It is documented as available
 * future defense-in-depth (docs/SUPERVISOR_DEPLOY.md) should a per-instance
 * owner-email config ever be introduced.
 *
 * Content-Encoding handling (verified empirically under Node 26 / undici — the
 * runtime that runs the Next app via `next start`): undici's `fetch`
 * AUTO-DECOMPRESSES the upstream body but leaves the upstream `Content-Encoding`
 * (and a now-stale `Content-Length`) on the headers — the SAME behavior as Bun.
 * Returning those unchanged would make the browser try to gunzip already-
 * plaintext bytes (ZlibError) and truncate the body to the compressed length.
 * So when an encoding is present we strip BOTH framing headers and re-stream the
 * identity body (the runtime re-frames it chunked). Uncompressed responses are
 * passed through untouched so their accurate Content-Length is preserved.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth, type RouteContext } from "@/lib/api";
import { BASE_PATH, INSTANCE_SLUG } from "@/lib/base-path";
import {
  isPortProxyable,
  rewriteLocationHeader,
  rewriteCookiePath,
  injectBaseTag,
  type RewriteOptions,
} from "@/lib/proxy-port-utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("PortProxy");

/**
 * Upper bound on how long we wait for the loopback upstream. In-pod loopback to
 * `127.0.0.1` never does DNS, so the only failure modes are an immediate
 * `ECONNREFUSED` (nothing listening) or a hung/slow upstream (a port that
 * accepts the connection but never responds). The timeout bounds the latter so
 * a dead-but-not-refusing port returns a friendly 502 instead of hanging the
 * request forever. Generous enough for legitimately slow first-paint dev
 * servers (SSR cold start, on-demand bundling).
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Hop-by-hop headers (RFC 7230 §6.1) plus `host` that must NOT be forwarded to
 * the loopback upstream. We drop `host` so the fetch sets it to the upstream
 * authority (`127.0.0.1:<port>`); forwarding the public host would confuse a
 * dev server's host checks.
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
  "host",
]);

/** The slug used when re-homing browser-facing paths (Location/cookies/base). */
function rewriteOptions(port: number): RewriteOptions {
  // INSTANCE_SLUG is the canonical slug; fall back to deriving from BASE_PATH's
  // last segment (both come from `@/lib/base-path`). Empty for unscoped deploys.
  const slug = INSTANCE_SLUG || (BASE_PATH ? BASE_PATH.split("/").filter(Boolean).at(-1) ?? null : null);
  return { slug: slug || null, port };
}

/**
 * Build the headers to send upstream: copy all, drop hop-by-hop + host, AND
 * strip the caller's credentials.
 *
 * The upstream is ARBITRARY, potentially-untrusted in-pod code (dev servers,
 * agent processes) — exactly the surface this feature exposes. We therefore
 * withhold the host-scoped credentials this proxy authenticates with so they
 * can't be exfiltrated by the proxied app: the `Cookie` (NextAuth session +
 * `CF_Authorization` Cloudflare Access JWT), `Authorization` (Bearer API key),
 * and every Cloudflare Access header (`cf-*` / `x-cf-*`, e.g.
 * `cf-access-jwt-assertion`, `cf-access-authenticated-user-email`). This mirrors
 * the WS bridge, which already withholds these. Normal app headers
 * (content-type, accept, accept-language, user-agent, …) are forwarded.
 */
function buildUpstreamHeaders(request: Request): Headers {
  const out = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "cookie" || lower === "authorization") return;
    if (lower.startsWith("cf-") || lower.startsWith("x-cf-")) return;
    out.set(key, value);
  });
  return out;
}

/**
 * Copy the upstream response headers for the browser, dropping hop-by-hop
 * headers and rewriting `Location` + every `Set-Cookie` to stay inside the proxy
 * path. Content-Encoding/Length stripping is handled by the caller (it depends
 * on whether we re-stream or pass through).
 */
function buildResponseHeaders(
  upstream: Response,
  opts: RewriteOptions,
): Headers {
  const out = new Headers();

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    // Set-Cookie and Location are handled explicitly below.
    if (lower === "set-cookie" || lower === "location") return;
    out.set(key, value);
  });

  // Rewrite Location (redirects) so the browser stays under the proxy path.
  const location = upstream.headers.get("location");
  if (location !== null) {
    out.set("location", rewriteLocationHeader(location, opts));
  }

  // Rewrite every Set-Cookie's Path. getSetCookie() splits multiple cookies
  // correctly (verified available under Node 26 / undici).
  const cookies = upstream.headers.getSetCookie();
  for (const cookie of cookies) {
    out.append("set-cookie", rewriteCookiePath(cookie, opts));
  }

  return out;
}

/** Whether a Content-Type denotes HTML we should buffer to inject `<base>`. */
function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  return /\btext\/html\b/i.test(contentType);
}

async function handler(
  request: Request,
  { params }: { userId: string; params?: Record<string, string> },
): Promise<NextResponse> {
  const portRaw = params?.port ?? "";
  const port = Number(portRaw);

  if (!/^\d+$/.test(portRaw) || !Number.isInteger(port)) {
    return NextResponse.json(
      { error: "Invalid port", code: "INVALID_PORT" },
      { status: 400 },
    );
  }

  if (!isPortProxyable(port)) {
    return NextResponse.json(
      {
        error: `Port ${port} cannot be proxied`,
        code: "PORT_BLOCKED",
      },
      { status: 403 },
    );
  }

  // Reassemble the catch-all path segments and re-attach the query string.
  // Next.js resolves a `[...path]` catch-all to a `string[]` (one entry per
  // segment), or `undefined` when the proxied path is empty (`/proxy/<port>/`).
  // The shared `RouteContext` types params as `Record<string, string>`, which is
  // a lie for catch-alls, so we narrow at runtime instead of widening that type.
  const incomingUrl = new URL(request.url);
  const rawPath: unknown = params?.path;
  const joined = Array.isArray(rawPath)
    ? rawPath.join("/")
    : typeof rawPath === "string"
      ? rawPath
      : "";
  const path = joined.startsWith("/") ? joined : `/${joined}`;
  const upstreamUrl = `http://127.0.0.1:${port}${path}${incomingUrl.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: buildUpstreamHeaders(request),
    redirect: "manual",
    // Bound a hung/slow upstream so a dead-but-not-refusing port can't hang the
    // request indefinitely (loopback never does DNS, so this is the real risk).
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  // GET/HEAD must not carry a body; everything else streams the request body.
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Required by undici when streaming a ReadableStream request body.
    (init as { duplex?: "half" }).duplex = "half";
  }

  const opts = rewriteOptions(port);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    // Distinguish connection-refused (nothing listening) from other failures
    // for a friendlier message. undici nests the OS error under `.cause`.
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : undefined;
    const code =
      cause && "code" in cause ? String((cause as { code?: unknown }).code) : "";
    const refused = code === "ECONNREFUSED";
    // AbortSignal.timeout fires a DOMException named "TimeoutError" (some
    // runtimes surface a plain "AbortError"); treat either as our deadline.
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    log.warn("Upstream port unreachable", {
      port,
      refused,
      timedOut,
      code: code || undefined,
      error: String(error),
    });

    let message: string;
    if (refused) {
      message = `Nothing is listening on port ${port} inside this instance. Start your dev server, then reload.`;
    } else if (timedOut) {
      message = `Port ${port} accepted the connection but did not respond in time inside this instance.`;
    } else {
      message = `Failed to reach port ${port} inside this instance.`;
    }

    return new NextResponse(message, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const headers = buildResponseHeaders(upstream, opts);
  const hadEncoding = upstream.headers.has("content-encoding");

  // HTML must be buffered so we can inject the <base> tag for relative-URL
  // resolution. Everything else is streamed through without buffering.
  if (isHtml(upstream.headers.get("content-type"))) {
    const html = injectBaseTag(await upstream.text(), opts);
    // We hold the decoded text, so any encoding/length headers are now stale.
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new NextResponse(html, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  // Non-HTML: stream the body through. If the upstream was compressed, undici
  // already decoded it (see file header) so we MUST drop the now-misleading
  // Content-Encoding + stale Content-Length and let the runtime re-frame.
  if (hadEncoding) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

const wrapped = withAuth(handler);

/**
 * Next's generated route validator types this `[...path]` catch-all's context as
 * `{ params: Promise<{ port: string; path: string[] }> }` (the `path` segment is
 * a REQUIRED `string[]`). The shared `withAuth`/`RouteContext` types params as
 * `Promise<Record<string, string>>`, whose index signature yields `path: string`
 * — so the wrapped handler doesn't satisfy the generated constraint. We bridge
 * the two LOCALLY here (rather than widening the shared `RouteContext`, which
 * would cascade onto every `[id]` route) with a thin per-method export that
 * carries Next's expected signature and delegates to the wrapped handler. The
 * handler already normalizes `params.path` at runtime (array / absent → joined
 * path), so the local cast is sound.
 */
type ProxyRouteContext = { params: Promise<{ port: string; path: string[] }> };

function proxyRoute(
  request: NextRequest,
  context: ProxyRouteContext,
): Promise<NextResponse> {
  return wrapped(request, context as unknown as RouteContext);
}

export const GET = proxyRoute;
export const POST = proxyRoute;
export const PUT = proxyRoute;
export const PATCH = proxyRoute;
export const DELETE = proxyRoute;
export const HEAD = proxyRoute;
export const OPTIONS = proxyRoute;
