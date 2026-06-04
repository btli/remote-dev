/**
 * Open-redirect guard for the login page's `?callbackUrl=` round-trip.
 *
 * The login page reads `?callbackUrl=` and hands it to `signIn({ callbackUrl })`
 * so the user returns to their original destination after OIDC sign-in (the
 * mobile `/<slug>/auth/mobile-callback` deep-link bridge relies on this). To
 * avoid an open redirect, accept ONLY same-origin relative paths: a single
 * leading `/`, rejecting scheme-relative (`//host`) and backslash-escaped
 * (`/\host`) forms that browsers may resolve to a foreign origin.
 *
 * Kept in its own module (rather than inline in the server-component page) so it
 * can be unit-tested without pulling NextAuth/server-only imports into the test
 * realm.
 */
export function safeCallbackPath(
  raw: string | string[] | undefined,
): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof v === "string" &&
    v.startsWith("/") &&
    !v.startsWith("//") &&
    !v.startsWith("/\\")
  ) {
    return v;
  }
  return undefined;
}
