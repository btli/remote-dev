/**
 * Mobile callback helpers for instance auth.
 *
 * Provides utilities for collecting session cookies (including NextAuth's
 * chunked-cookie layout) and encoding them as a base64url JSON payload
 * suitable for the `remotedev://` deep link.
 */

export type AuthCookie = { name: string; value: string; path: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collect the session cookie(s) from a cookie store by exact name.
 *
 * NextAuth v5 may split large JWTs into numbered chunks
 * (`<name>.0`, `<name>.1`, …). This helper handles both the single-cookie
 * and the chunked layouts, returning them in ascending numeric order.
 *
 * @param store  - An object with a `getAll()` method (compatible with the
 *                 `next/headers` cookie store interface).
 * @param cookieName - The base session-token cookie name (e.g.
 *                 `"__Secure-rdv-demo-session-token"`).
 * @param path   - The cookie `path` to attach to every returned entry.
 */
export function collectSessionCookies(
  store: { getAll: () => { name: string; value: string }[] },
  cookieName: string,
  path: string,
): AuthCookie[] {
  const chunkRe = new RegExp(`^${escapeRegExp(cookieName)}\\.(\\d+)$`);
  const all = store.getAll();

  // Prefer the exact (unchunked) cookie when present.
  const exact = all.find((c) => c.name === cookieName);
  if (exact) {
    return [{ name: exact.name, value: exact.value, path }];
  }

  // Fall back to numbered chunks, sorted ascending.
  return all
    .map((c) => ({ c, m: chunkRe.exec(c.name) }))
    .filter(
      (x): x is { c: { name: string; value: string }; m: RegExpExecArray } =>
        x.m !== null,
    )
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => ({ name: x.c.name, value: x.c.value, path }));
}

/**
 * Serialize a list of `AuthCookie` entries to a base64url-encoded JSON string
 * (no `+`, `/`, or `=` characters) suitable for use as a URL query parameter.
 */
export function encodeAuthCookies(cookies: AuthCookie[]): string {
  return Buffer.from(JSON.stringify(cookies)).toString("base64url");
}
