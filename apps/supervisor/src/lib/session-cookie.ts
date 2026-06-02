/**
 * NextAuth session-cookie naming — Edge-safe, dependency-free.
 *
 * The proxy runs at the Edge boundary and must NOT import `@/auth` (which pulls
 * NextAuth + the libsql DB). It still needs the EXACT session-cookie name that
 * `auth()` writes so `getToken()` can find — and decrypt — the cookie. This
 * module computes that name purely from env, with no imports.
 *
 * NextAuth v5 (`@auth/core@0.41.x`, the lockfile version) names the session
 * cookie `${prefix}authjs.session-token`, where `prefix` is `__Secure-` when the
 * app uses secure cookies and `""` otherwise. Auth.js derives `useSecureCookies`
 * from `config.useSecureCookies ?? url.protocol === "https:"`, and next-auth v5
 * overrides that request URL with `AUTH_URL`/`NEXTAUTH_URL` when set. The
 * Supervisor sets neither `useSecureCookies` nor `cookies` in its NextAuth
 * config, so the cookie name is fully determined by the effective URL's scheme —
 * which we reproduce here from `AUTH_URL`/`NEXTAUTH_URL`.
 *
 * CRITICAL: `getToken({ salt })` defaults `salt = cookieName`, and the JWE is
 * decrypted with that salt. `auth()` encodes with salt = its own cookie name, so
 * passing the matching `cookieName` to `getToken` fixes BOTH the cookie lookup
 * AND the decryption salt. A mismatch silently rejects valid sessions.
 */

/**
 * True when the Supervisor's NextAuth instance uses secure (`__Secure-`-prefixed)
 * cookies — i.e. the configured auth URL is HTTPS. Mirrors Auth.js's derivation
 * for this app's config (no explicit `useSecureCookies`).
 *
 * `request` (optional) lets a caller fall back to the request scheme when no
 * AUTH_URL is configured (local dev), matching what `auth()` would compute from
 * the incoming request URL in that case.
 */
export function isSecureAuthScheme(request?: {
  headers: { get(name: string): string | null };
  nextUrl?: { protocol?: string };
}): boolean {
  const configuredUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  if (configuredUrl) return configuredUrl.startsWith("https://");

  // No AUTH_URL (dev). Match auth()'s request-derived scheme: prefer the
  // forwarded proto (set by the router/CF), else the request URL's protocol.
  if (request) {
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    if (forwardedProto) return forwardedProto === "https";
    if (request.nextUrl?.protocol) return request.nextUrl.protocol === "https:";
  }
  return false;
}

/**
 * The exact NextAuth v5 session-cookie name for this app, given the secure
 * scheme. Pass the result to `getToken({ cookieName, secureCookie })`.
 */
export function getSessionCookieName(request?: {
  headers: { get(name: string): string | null };
  nextUrl?: { protocol?: string };
}): string {
  const secure = isSecureAuthScheme(request);
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}
