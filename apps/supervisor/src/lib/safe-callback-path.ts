/**
 * Open-redirect guard for the login page's `?callbackUrl=` round-trip.
 *
 * The login page reads `?callbackUrl=` and hands it to NextAuth (instance:
 * `signIn({ callbackUrl })`; supervisor: `signIn({ redirectTo })`) so the user
 * returns to their original destination after OIDC sign-in (the mobile
 * `/<slug>/auth/mobile-callback` deep-link bridge relies on this). To avoid an
 * open redirect, accept ONLY same-origin relative paths: a single leading `/`,
 * rejecting scheme-relative (`//host`) forms that resolve to a foreign origin.
 *
 * Also rejects any value containing a control char, whitespace (incl. tab/LF/CR)
 * or a backslash — browsers strip or fold these, e.g. "/\t//evil.com" →
 * "//evil.com" → a foreign origin. (This subsumes the explicit `/\` backslash
 * case.) The character-class test covers C0 controls + space (0x00–0x20) and
 * the backslash (0x5C).
 *
 * Kept in its own module (rather than inline in the server-component page) so it
 * can be unit-tested without pulling NextAuth/server-only imports into the test
 * realm. Mirrored byte-for-byte in `apps/supervisor/src/lib/safe-callback-path.ts`
 * (a separate package — do NOT import across packages).
 */
export function safeCallbackPath(
  raw: string | string[] | undefined,
): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return undefined;
  // Reject control/whitespace chars and backslashes browsers strip or fold:
  // e.g. "/\t//evil.com" → "//evil.com" → a foreign origin.
  if (/[\x00-\x20\\]/.test(v)) return undefined;
  if (!v.startsWith("/") || v.startsWith("//")) return undefined;
  return v;
}
