/**
 * Supervisor host-scope mobile-callback resolver — testable business logic.
 *
 * Extracts identity resolution and deep-link construction from the
 * `auth/mobile-callback/page.tsx` server component so it can be unit-tested
 * without a browser. The page is a thin wrapper that calls
 * `resolveSupervisorMobileCallback()` and delegates to `redirect()` or renders
 * the existing `ErrorPage`.
 *
 * Two auth paths (precedence: CF first):
 *   1. CF path — `CF_Authorization` cookie present + `validateAccessJWT` passes:
 *      emit `scope=host`, legacy `cfToken=`, `authCookies=[{CF_Authorization@/}]`.
 *   2. OIDC path — NextAuth session (`auth()`): scan the cookie store for the
 *      session-token cookie (robust base-name detection per §5.4 of the design),
 *      collect base + chunks, emit `scope=host`, `authCookies=[session cookie(s)@/]`.
 *      If a user was resolved but no cookie was found → return a helpful error
 *      (avoids a login loop).
 *   3. No identity → `{ kind: "login" }`.
 */

import { cookies } from "next/headers";
import { validateAccessJWT } from "@/lib/cf-access";
import { resolveSupervisorUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { auth, isOidcSignInAllowed } from "@/auth";

const log = createLogger("auth/mobile-callback");

// ---------------------------------------------------------------------------
// Shared types (intentionally duplicated here — apps/supervisor is an isolated
// workspace and must not share a module with the root app).
// ---------------------------------------------------------------------------

export type AuthCookie = { name: string; value: string; path: string };

export type MobileCallbackResult =
  | { kind: "redirect"; url: string }
  | { kind: "login" }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// collectSessionCookies
// ---------------------------------------------------------------------------

/**
 * Collect the named session cookie and all its numeric chunks from `store`.
 *
 * Matches:
 *   - exactly `cookieName` (base cookie)
 *   - `cookieName + "." + <digits>` (Auth.js chunk cookies, e.g. `.0`, `.1`)
 *
 * Chunks are returned in ascending numeric order after the base (if present),
 * giving `[base, .0, .1, …]` when all exist, or ordered chunks when the base
 * is absent.
 *
 * Returns `[]` when neither the base nor any chunk is present.
 *
 * NOTE: Uses `startsWith` + `/^\d+$/` to detect chunks — never a substring
 * match — so `authjs.session-token-callback-url` is never captured.
 */
export function collectSessionCookies(
  store: { getAll: () => { name: string; value: string }[] },
  cookieName: string,
  path: string,
): AuthCookie[] {
  const prefix = cookieName + ".";
  const all = store.getAll();

  let base: AuthCookie | null = null;
  const chunks: Array<{ index: number; cookie: AuthCookie }> = [];

  for (const c of all) {
    if (c.name === cookieName) {
      base = { name: c.name, value: c.value, path };
    } else if (c.name.startsWith(prefix)) {
      const suffix = c.name.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        chunks.push({
          index: parseInt(suffix, 10),
          cookie: { name: c.name, value: c.value, path },
        });
      }
    }
  }

  // Sort chunks by numeric index (ascending).
  chunks.sort((a, b) => a.index - b.index);

  const result: AuthCookie[] = [];
  if (base) result.push(base);
  for (const { cookie } of chunks) result.push(cookie);
  return result;
}

// ---------------------------------------------------------------------------
// encodeAuthCookies
// ---------------------------------------------------------------------------

/**
 * Base64url-encode (RFC 4648 §5, no padding) a JSON array of AuthCookies.
 * Produces a URL-safe string with no `+`/`/`/`=` characters.
 */
export function encodeAuthCookies(c: AuthCookie[]): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

// ---------------------------------------------------------------------------
// Session-cookie name resolution (§5.4 robustness)
// ---------------------------------------------------------------------------

/**
 * Regex pattern for Auth.js session-token cookie names (supervisor variant).
 * Matches the base name and any numeric chunks.
 *
 * Examples that match:
 *   authjs.session-token
 *   __Secure-authjs.session-token
 *   __Host-authjs.session-token
 *   authjs.session-token.0
 *   __Secure-authjs.session-token.1
 */
const SESSION_TOKEN_PATTERN = /^(__Secure-|__Host-)?authjs\.session-token(\.\d+)?$/;

/**
 * Resolve the session-cookie BASE name by scanning the actual cookie store —
 * never relying solely on an env/AUTH_URL guess (§5.4 robustness, Codex #4).
 *
 * Strategy:
 *   1. Primary: find the first cookie whose name matches `SESSION_TOKEN_PATTERN`
 *      and strip any `.<n>` chunk suffix to get the base name.
 *   2. Returns `null` when no matching cookie is found (no OIDC session present).
 */
function resolveSessionCookieBaseName(
  store: { getAll: () => { name: string; value: string }[] },
): string | null {
  for (const c of store.getAll()) {
    const m = SESSION_TOKEN_PATTERN.exec(c.name);
    if (m) {
      // Strip the chunk suffix (`.<digits>`) to get the base name.
      const chunkSuffix = m[2]; // e.g. ".0", or undefined
      const base = chunkSuffix ? c.name.slice(0, -chunkSuffix.length) : c.name;
      return base;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Core logic for the supervisor host-scope mobile-callback route.
 *
 * Uses `cookies()` from `next/headers` (server component / Route Handler
 * context). Does NOT accept a `NextRequest` — this is a Server Component.
 *
 * @see `apps/supervisor/src/app/auth/mobile-callback/page.tsx` (thin wrapper)
 */
export async function resolveSupervisorMobileCallback(): Promise<MobileCallbackResult> {
  const cookieStore = await cookies();

  // ------------------------------------------------------------------
  // Path 1: Cloudflare Access (preserve current behavior)
  // ------------------------------------------------------------------
  const cfToken = cookieStore.get("CF_Authorization")?.value ?? null;

  if (cfToken) {
    const cfUser = await validateAccessJWT(cfToken);
    if (cfUser) {
      const user = await resolveSupervisorUser(cfUser.email);
      log.info("Host-scope mobile callback issued (CF path)", {
        userId: user.id,
        email: user.email,
      });

      const authCookies: AuthCookie[] = [
        { name: "CF_Authorization", value: cfToken, path: "/" },
      ];

      const url =
        `remotedev://auth/callback` +
        `?scope=host` +
        `&cfToken=${encodeURIComponent(cfToken)}` +
        `&authCookies=${encodeURIComponent(encodeAuthCookies(authCookies))}` +
        `&email=${encodeURIComponent(user.email ?? "")}` +
        `&userId=${encodeURIComponent(user.id)}`;

      return { kind: "redirect", url };
    }
    // CF token present but invalid — fall through to OIDC path.
    log.debug("CF_Authorization present but invalid; falling through to OIDC");
  }

  // ------------------------------------------------------------------
  // Path 2: OIDC / NextAuth session
  // ------------------------------------------------------------------
  const session = await auth();
  const sessionEmail = session?.user?.email ?? null;

  if (sessionEmail) {
    // AUTHORIZATION GATE (must mirror resolveAuthenticatedEmail in
    // src/lib/auth.ts, NOT just trust the session). The signIn callback in
    // src/auth.ts enforces isOidcSignInAllowed at LOGIN time, but sessions are
    // JWT and resolveSupervisorUser auto-creates a `viewer` on first sight — so
    // a session whose supervisor_user row was later deleted would otherwise be
    // silently re-admitted here. resolveAuthenticatedEmail therefore re-applies
    // the SAME closed-allowlist predicate per-request for revocation; the mobile
    // callback bypasses that path, so we re-apply it ourselves BEFORE minting a
    // host credential. A failing check is treated as unauthenticated → login
    // (never grant a host credential to a user the supervisor app would reject).
    if (!(await isOidcSignInAllowed(sessionEmail))) {
      log.warn(
        "OIDC session email not in supervisor allowlist; treating as unauthenticated",
      );
      return { kind: "login" };
    }

    const user = await resolveSupervisorUser(sessionEmail);

    // Resolve session-cookie base name robustly by scanning the cookie store
    // (§5.4 / Codex #4 — do NOT rely on env-derived name alone).
    const baseName = resolveSessionCookieBaseName(cookieStore);

    if (!baseName) {
      // The NextAuth session resolved but we cannot find its cookie. This is
      // unexpected (the session is in the cookie store *somewhere*), but we
      // must not redirect to a deep link with no auth cookies — that would
      // silently give the app a credential-less URL and cause a login loop.
      log.warn("OIDC session resolved but session cookie not found in store", {
        userId: user.id,
        email: user.email,
      });
      return {
        kind: "error",
        message:
          "Your session is missing its authentication cookie. Please sign in again.",
      };
    }

    const authCookies = collectSessionCookies(cookieStore, baseName, "/");

    if (authCookies.length === 0) {
      // Defensive: resolveSessionCookieBaseName found the name but
      // collectSessionCookies returned nothing (shouldn't happen).
      log.warn("OIDC session cookie found by scan but collectSessionCookies empty", {
        userId: user.id,
        email: user.email,
        baseName,
      });
      return {
        kind: "error",
        message:
          "Your session is missing its authentication cookie. Please sign in again.",
      };
    }

    log.info("Host-scope mobile callback issued (OIDC path)", {
      userId: user.id,
      email: user.email,
    });

    const url =
      `remotedev://auth/callback` +
      `?scope=host` +
      `&authCookies=${encodeURIComponent(encodeAuthCookies(authCookies))}` +
      `&email=${encodeURIComponent(user.email ?? "")}` +
      `&userId=${encodeURIComponent(user.id)}`;

    return { kind: "redirect", url };
  }

  // ------------------------------------------------------------------
  // Path 3: No identity — bounce to login
  // ------------------------------------------------------------------
  return { kind: "login" };
}
