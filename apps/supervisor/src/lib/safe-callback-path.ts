/**
 * Open-redirect guard for the supervisor login page's `?callbackUrl=`.
 *
 * The login page reads `?callbackUrl=` and uses it as NextAuth's `redirectTo`
 * so the user returns to their original destination after OIDC sign-in. To
 * avoid an open redirect, accept ONLY same-origin relative paths: a single
 * leading `/`, rejecting scheme-relative (`//host`) and backslash-escaped
 * (`/\host`) forms that browsers may resolve to a foreign origin.
 *
 * Kept in its own module (rather than inline in the server-component page) so it
 * can be unit-tested without pulling NextAuth/server-only imports into the test
 * realm. The supervisor is a separate package, so this is an intentional copy of
 * the instance helper — do NOT import across packages.
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
