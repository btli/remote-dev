/**
 * NextAuth v5 cookie path-scoping for `RDV_BASE_PATH` multi-instance hosting.
 *
 * Two pods on the same host (e.g. `https://host/alpha` and `https://host/beta`)
 * would otherwise step on each other's cookies — the browser sends every
 * `Path=/`-scoped cookie to both prefixes, and NextAuth's default cookie names
 * are identical across instances. We solve both problems here by:
 *
 *   1. Scoping each cookie's `path` to the instance's basePath (cookies set at
 *      `/alpha` are no longer sent on requests to `/beta`).
 *   2. Embedding the instance slug in each cookie's *name* as belt-and-suspenders
 *      so the browser's Application tab clearly shows which instance owns which
 *      cookie even when several share a host.
 *
 * Single-server deployments (no `RDV_BASE_PATH`) get NextAuth's built-in defaults
 * unchanged — `buildScopedCookies()` returns `undefined` and `src/auth.ts` omits
 * the `cookies` key entirely. This is what preserves AC-1 (no regressions when
 * the env var is unset).
 *
 * Caveats baked into the design:
 *
 *   - The `__Host-` cookie prefix (used for CSRF) requires `Path=/` per RFC 6265bis.
 *     So the CSRF cookie is *not* path-scoped — it lives at `/`. That's safe
 *     because two instances on the same host use different `AUTH_SECRET`s, so a
 *     CSRF token minted by `/alpha` cannot validate against `/beta`'s secret.
 *     Path-scoping the other cookies is the real isolation; the CSRF name still
 *     differs per-slug to keep the browser UI legible.
 *
 *   - `__Secure-` and `__Host-` cookie *prefixes* require `Secure=true` per RFC.
 *     Local HTTP dev (`AUTH_URL=http://localhost:...`) can't set those cookies,
 *     so when we detect HTTP we drop the prefix and the `secure` flag together.
 *     Production with `AUTH_URL=https://...` gets the hardened versions.
 *
 *   - NextAuth v5 writes 7 cookies (not the 3 the spec excerpt §7.6 listed).
 *     Missing pkce / state / nonce scoping would leak OAuth state across
 *     instances — the very regression this feature is meant to prevent. We
 *     scope all 7, including `webauthnChallenge`, even though WebAuthn is not
 *     currently configured — the cost is trivial and it keeps this module a
 *     single source of truth.
 */

import type { NextAuthConfig } from "next-auth";
import { COOKIE_PATH, INSTANCE_SLUG } from "@/lib/base-path";

// Derive CookiesOptions from NextAuthConfig so we stay independent of
// @auth/core peer-dep version drift. NextAuthConfig["cookies"] is the
// `Partial<CookiesOptions>` shape that NextAuth accepts; we re-tighten
// keys to required for ergonomics in this module — buildScopedCookies()
// always returns a fully-populated block when it returns at all, so
// callers (and tests) shouldn't need optional-chaining on each cookie.
type CookiesOptions = Required<NonNullable<NextAuthConfig["cookies"]>>;

/**
 * True when `AUTH_URL` (or legacy `NEXTAUTH_URL`) advertises https. Drives both
 * the `secure` flag on every cookie and the `__Secure-` / `__Host-` name prefix.
 */
function isSecureScheme(): boolean {
  const url = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  return url.startsWith("https://");
}

/**
 * Build the scoped name for a cookie. Prefixed in HTTPS mode; bare in HTTP/dev
 * mode so the browser actually accepts the cookie (cookie prefixes require
 * Secure).
 */
function scopedName(
  slug: string,
  suffix: string,
  prefix: "__Secure-" | "__Host-",
  secure: boolean,
): string {
  if (secure) return `${prefix}rdv-${slug}-${suffix}`;
  return `rdv-${slug}-${suffix}`;
}

/**
 * True when this instance should run with default (un-scoped) NextAuth cookies.
 *
 * The conservative gate is `COOKIE_PATH === "/"`: if there is no basePath then
 * `Path=/` is what every cookie would carry anyway, and prefixing cookie names
 * with a slug we never validate against a basePath produces incoherent half-
 * scoped state (Codex S-2). The `INSTANCE_SLUG === ""` check is kept as a
 * second belt: even with a basePath we cannot construct cookie names without
 * a slug, so bail out of scoping in that case too.
 */
function isUnscopedMode(): boolean {
  return COOKIE_PATH === "/" || INSTANCE_SLUG === "";
}

/**
 * Cookie name NextAuth uses for the JWT session token under the current
 * instance config. Mirrors NextAuth/AuthJS defaults when `buildScopedCookies()`
 * returns `undefined` so `getToken({ cookieName })` calls — notably in
 * `src/proxy.ts` — read the same cookie the auth handler writes.
 *
 * AuthJS's default name is `__Secure-authjs.session-token` under https and
 * `authjs.session-token` under http; next-auth v5 inherits those names verbatim.
 */
export function getSessionCookieName(): string {
  const secure = isSecureScheme();
  if (isUnscopedMode()) {
    return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  }
  return scopedName(INSTANCE_SLUG, "session-token", "__Secure-", secure);
}

/**
 * Returns a NextAuth `cookies` config block that path-scopes every cookie to
 * the current instance's basePath. Returns `undefined` when there is no
 * basePath, so NextAuth uses its built-in defaults (single-server mode).
 */
export function buildScopedCookies(): CookiesOptions | undefined {
  if (isUnscopedMode()) return undefined;

  const secure = isSecureScheme();
  const sessionTokenName = scopedName(INSTANCE_SLUG, "session-token", "__Secure-", secure);
  const callbackUrlName = scopedName(INSTANCE_SLUG, "callback-url", "__Secure-", secure);
  // CSRF uses __Host- which mandates Path=/, so we keep that even when scoping
  // every other cookie to the basePath. See file header for rationale.
  const csrfTokenName = scopedName(INSTANCE_SLUG, "csrf-token", "__Host-", secure);
  const pkceName = scopedName(INSTANCE_SLUG, "pkce-code-verifier", "__Secure-", secure);
  const stateName = scopedName(INSTANCE_SLUG, "state", "__Secure-", secure);
  const nonceName = scopedName(INSTANCE_SLUG, "nonce", "__Secure-", secure);
  const webauthnName = scopedName(INSTANCE_SLUG, "webauthn-challenge", "__Secure-", secure);

  return {
    sessionToken: {
      name: sessionTokenName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
      },
    },
    callbackUrl: {
      name: callbackUrlName,
      options: {
        // AuthJS deep-merges user-supplied cookie options into its built-in
        // defaults; that default is `httpOnly: true`. Earlier revisions of
        // this file omitted the flag, intending to mirror AuthJS, and a test
        // asserted on the literal pre-merge output. The post-merge effective
        // value was still `true` — the test passed for the wrong reason. We
        // now set it explicitly so the wire-level behavior matches what the
        // test sees and audits stay readable. (Codex S-1 / Opus C-1.)
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
      },
    },
    csrfToken: {
      name: csrfTokenName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        // __Host- prefix requires Path=/. Cookie name still differs per slug
        // so browsers show distinct entries per instance.
        path: "/",
        secure,
      },
    },
    pkceCodeVerifier: {
      name: pkceName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
        maxAge: 60 * 15, // 15 minutes — matches NextAuth's default for PKCE
      },
    },
    state: {
      name: stateName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
        maxAge: 60 * 15,
      },
    },
    nonce: {
      name: nonceName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
      },
    },
    webauthnChallenge: {
      name: webauthnName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: COOKIE_PATH,
        secure,
        maxAge: 60 * 15,
      },
    },
  };
}
