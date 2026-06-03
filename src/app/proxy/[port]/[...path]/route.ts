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
 * owner of the instance. (The optional strict requesting-email == instance-owner
 * check is deferred to B4 per the plan, §7.)
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
import { withAuth } from "@/lib/api";
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

/** Build the headers to send upstream: copy all, drop hop-by-hop + host. */
function buildUpstreamHeaders(request: Request): Headers {
  const out = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
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
  // Next.js gives `[...path]` as a single joined string in params (already
  // URL-decoded per segment is NOT guaranteed, so we use what Next provides).
  const incomingUrl = new URL(request.url);
  const pathPart = params?.path ?? "";
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const upstreamUrl = `http://127.0.0.1:${port}${path}${incomingUrl.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: buildUpstreamHeaders(request),
    redirect: "manual",
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

    log.warn("Upstream port unreachable", {
      port,
      refused,
      code: code || undefined,
      error: String(error),
    });

    const message = refused
      ? `Nothing is listening on port ${port} inside this instance. Start your dev server, then reload.`
      : `Failed to reach port ${port} inside this instance.`;

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

export const GET = wrapped;
export const POST = wrapped;
export const PUT = wrapped;
export const PATCH = wrapped;
export const DELETE = wrapped;
export const HEAD = wrapped;
export const OPTIONS = wrapped;
