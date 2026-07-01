/**
 * Pure helpers for the in-pod HTTP port proxy (plan §6 B1).
 *
 * These functions are side-effect-free and contain NO I/O so they can be unit
 * tested in isolation. The route handler at `src/app/proxy/[port]/[...path]`
 * composes them around a `fetch` to `http://127.0.0.1:<port>`.
 *
 * The proxy serves URLs of the shape `<basePath>/proxy/<port>/<...path>`, where
 * `<basePath>` is this instance's `RDV_BASE_PATH` (e.g. `/dev`). Next.js strips
 * the basePath before the handler runs, so the handler only ever sees
 * `/proxy/<port>/...`. When we rewrite redirects/cookies/`<base>` for the
 * BROWSER, however, we must put the basePath BACK on, because the browser talks
 * to the public origin (`https://rdv.example.com/dev/...`). We derive the
 * basePath from the slug the caller passes in (rather than reading `BASE_PATH`
 * directly) so these helpers stay pure and testable across slug states.
 */

/**
 * Ports that must never be proxied, regardless of listening status:
 * - `6001` — the instance's own Next.js HTTP server (proxying it would loop).
 * - `6002` — the terminal server / internal WS+API surface.
 *
 * The literal defaults are always blocked; we ALSO union in the env-configured
 * `PORT` / `TERMINAL_PORT` so a non-default deployment still refuses to proxy its
 * own HTTP/WS surface. This module runs in both the Next server and the tsx
 * terminal-server contexts, where `process.env` is available; if it is ever
 * bundled client-side, `process.env.PORT` is `undefined` → `NaN` and is
 * harmlessly filtered out below.
 *
 * Privileged ports (`< 1024`) are blocked separately in {@link isPortProxyable}.
 */
export const HARD_BLOCKED: ReadonlySet<number> = new Set(
  [6001, 6002, Number(process.env.PORT), Number(process.env.TERMINAL_PORT)].filter(
    (p): p is number => Number.isInteger(p) && p > 0,
  ),
);

/** Lowest non-privileged port. Anything below this is blocked. */
const MIN_UNPRIVILEGED_PORT = 1024;
/** Highest valid TCP port. */
const MAX_PORT = 65535;

/**
 * Syntactic allowlist check for a proxy target port.
 *
 * Returns true iff `port` is an integer in `[1024, 65535]` and not in
 * {@link HARD_BLOCKED}. Privileged ports (`< 1024`), non-integers, NaN, and
 * out-of-range values all return false.
 *
 * NOTE: this is ONLY the syntactic gate. The runtime membership check
 * ("is this port in the listening ∪ claimed set?") is layered on separately by
 * Track A (A4 `GET /api/ports/proxyable`); this util stays self-contained and
 * side-effect-free so it can be reused on both the route and the WS bridge.
 */
export function isPortProxyable(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  if (port < MIN_UNPRIVILEGED_PORT || port > MAX_PORT) return false;
  if (HARD_BLOCKED.has(port)) return false;
  return true;
}

/** Options shared by the rewrite helpers: the instance slug + the target port. */
export interface RewriteOptions {
  /** The instance slug (e.g. "dev"), or null/empty for an unscoped deployment. */
  slug: string | null;
  /** The proxied upstream port. */
  port: number;
}

/**
 * The absolute path prefix that every browser-facing proxy URL lives under,
 * WITHOUT a trailing slash: `<basePath>/proxy/<port>`.
 *
 * Examples:
 *   { slug: "dev", port: 6000 } → "/dev/proxy/6000"
 *   { slug: null,  port: 6000 } → "/proxy/6000"
 *   { slug: "",    port: 6000 } → "/proxy/6000"
 */
export function proxyBasePath(opts: RewriteOptions): string {
  const slug = opts.slug?.trim();
  const prefix = slug ? `/${slug}` : "";
  return `${prefix}/proxy/${opts.port}`;
}

/**
 * Rewrite an upstream `Location` redirect so the browser stays inside the proxy.
 *
 * - Root-relative / same-origin absolute paths (`/foo`, `/`) → prefixed with the
 *   proxy base path (`/dev/proxy/6000/foo`).
 * - Already-proxied paths (`/dev/proxy/6000/...` or, defensively, an unprefixed
 *   `/proxy/6000/...`) are left as-is so the rewrite is idempotent.
 * - External absolute URLs (`http://other.example/...`) are left UNTOUCHED — the
 *   upstream deliberately redirected off-origin.
 * - Relative paths without a leading slash (`foo`, `../foo`) are resolved by the
 *   browser against the current proxied URL, so they are left untouched.
 */
export function rewriteLocationHeader(
  location: string,
  opts: RewriteOptions,
): string {
  if (location === "") return location;

  // Absolute URL with a scheme/authority (http://, https://, //host) → external;
  // leave untouched. (We intentionally don't try to detect "same public origin"
  // here — the handler doesn't reliably know the public host, and a path-based
  // redirect is the common case dev servers emit.)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location) || location.startsWith("//")) {
    return location;
  }

  // Only root-relative paths can be safely re-homed under the proxy base.
  // Non-slash-relative paths (e.g. "foo", "../x", "?q=1", "#frag") resolve
  // against the current proxied URL in the browser, so they need no rewrite.
  if (!location.startsWith("/")) return location;

  const base = proxyBasePath(opts);

  // Idempotent: already under the full proxy base (with slug).
  if (location === base || location.startsWith(`${base}/`)) return location;

  // Idempotent (defensive): already under an unprefixed `/proxy/<port>` base —
  // can happen if the upstream echoed a path it received pre-basePath-strip.
  const unprefixed = `/proxy/${opts.port}`;
  if (
    base !== unprefixed &&
    (location === unprefixed || location.startsWith(`${unprefixed}/`))
  ) {
    return location;
  }

  return `${base}${location}`;
}

/**
 * Rewrite the `Path=` attribute of a `Set-Cookie` so the cookie is scoped to the
 * proxy path instead of the upstream app's path.
 *
 * - `Path=/foo`  → `Path=<proxyBase>/foo`  (e.g. `/dev/proxy/6000/foo`)
 * - `Path=/`     → `Path=<proxyBase>/`
 * - NO `Path` attribute → left as-is. Per RFC 6265 the browser then defaults the
 *   cookie's path to the directory of the request URI, which is already inside
 *   the proxy path — so the safe default needs no rewrite, and adding one could
 *   only ever broaden scope incorrectly. (Documented choice: leave absent paths
 *   untouched.)
 * - An already-proxied `Path` is left as-is (idempotent).
 *
 * Only the first `Path=` is rewritten (a cookie has at most one). The match is
 * case-insensitive on the attribute name; the value is taken up to the next `;`.
 */
export function rewriteCookiePath(
  setCookie: string,
  opts: RewriteOptions,
): string {
  const base = proxyBasePath(opts);

  return setCookie.replace(
    /(;\s*)(path)(\s*=\s*)([^;]*)/i,
    (whole, sep: string, attr: string, eq: string, rawValue: string) => {
      const value = rawValue.trim();
      // Only root-relative paths get re-homed; anything else (empty, relative)
      // is left untouched.
      if (!value.startsWith("/")) return whole;
      // Idempotent: already under the proxy base.
      if (value === base || value.startsWith(`${base}/`)) return whole;
      const unprefixed = `/proxy/${opts.port}`;
      if (
        base !== unprefixed &&
        (value === unprefixed || value.startsWith(`${unprefixed}/`))
      ) {
        return whole;
      }
      return `${sep}${attr}${eq}${base}${value}`;
    },
  );
}

/**
 * Inject a `<base href="<proxyBase>/">` tag into an HTML document so that
 * relative asset/link URLs resolve against the proxy path rather than the bare
 * public origin.
 *
 * Insertion strategy (first match wins, all case-insensitive):
 *   1. Right after `<head ...>` (the normal case).
 *   2. Else right after `<html ...>` (no explicit `<head>`).
 *   3. Else prepend to the document (defensive — malformed/fragment HTML).
 *
 * If the document already contains a `<base ...>` tag we DON'T inject a second
 * one (the first `<base>` wins per the HTML spec; a duplicate would be ignored
 * but is noise we avoid).
 *
 * The `href` ALWAYS ends in a trailing slash so the browser treats it as a
 * directory base.
 */
export function injectBaseTag(html: string, opts: RewriteOptions): string {
  // Don't double-inject. Match an opening <base ...> tag (not a CSS/text "base").
  if (/<base[\s/>]/i.test(html)) return html;

  const baseTag = `<base href="${proxyBasePath(opts)}/">`;

  // 1. After the opening <head> tag (with any attributes).
  const headMatch = html.match(/<head\b[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + baseTag + html.slice(at);
  }

  // 2. After the opening <html> tag.
  const htmlMatch = html.match(/<html\b[^>]*>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, at) + baseTag + html.slice(at);
  }

  // 3. Defensive: no <head>/<html> — prepend.
  return baseTag + html;
}
