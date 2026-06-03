/**
 * Resolve the EXTERNAL origin (`scheme://host`) for building absolute redirect
 * URLs in the proxy/middleware.
 *
 * `request.url` / `request.nextUrl` reflect the INTERNAL server origin. In
 * production single-server SOCKET mode that is a random `http://localhost:<port>`
 * (the Next standalone server bound by `scripts/standalone-server.js` behind the
 * Cloudflare tunnel); for slug instances it is the pod's internal address.
 * Building an absolute redirect from it leaks that dead internal address into
 * the `Location`. `NextResponse.redirect` REQUIRES an absolute URL (a relative
 * `Location` throws `TypeError: Invalid URL` at runtime), so we cannot sidestep
 * with a relative path — instead derive the origin from the edge-forwarded
 * headers, which cloudflared / Traefik / the supervisor-router set to the real
 * public host.
 *
 * Precedence: `x-forwarded-host` → `host` → the internal `fallbackOrigin`.
 * Scheme: `x-forwarded-proto` → `https` for a real host, `http` only for
 * loopback dev. Forwarded headers may be comma-separated proxy chains; the first
 * value (closest to the client) wins.
 */
export function resolveExternalOrigin(
  getHeader: (name: string) => string | null | undefined,
  fallbackOrigin: string,
): string {
  const host = firstValue(getHeader("x-forwarded-host")) || firstValue(getHeader("host"));
  if (!host) return fallbackOrigin;
  const proto = firstValue(getHeader("x-forwarded-proto")) || (isLoopbackHost(host) ? "http" : "https");
  return `${proto}://${host}`;
}

function firstValue(value: string | null | undefined): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function isLoopbackHost(host: string): boolean {
  return /^(localhost|127\.\d|\[::1\]|::1)(:|$)/.test(host);
}
