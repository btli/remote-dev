/**
 * Mobile callback helpers for instance auth.
 *
 * Provides utilities for collecting session cookies (including NextAuth's
 * chunked-cookie layout) and encoding them as a base64url JSON payload
 * suitable for the `remotedev://` deep link.
 *
 * Also exposes `resolveInstanceMobileCallback`, the core business logic for
 * the `/auth/mobile-callback` page — testable without rendering Next.js pages.
 */

import { cookies } from "next/headers";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { getAuthSession } from "@/lib/auth-utils";
import { getOrCreateUserByEmail } from "@/lib/user-identity";
import { createApiKey } from "@/services/api-key-service";
import { getSessionCookieName } from "@/lib/auth-cookies";
import { COOKIE_PATH } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth/mobile-callback");

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
export function encodeAuthCookies(authCookies: AuthCookie[]): string {
  return Buffer.from(JSON.stringify(authCookies)).toString("base64url");
}

// ─── resolveInstanceMobileCallback ───────────────────────────────────────────

export type MobileCallbackResult =
  | { kind: "redirect"; url: string }
  | { kind: "login" }
  | { kind: "error"; message: string };

/** Build a `remotedev://auth/callback?…` deep link from the supplied params. */
function deepLink(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") q.set(k, v);
  }
  return `remotedev://auth/callback?${q.toString()}`;
}

/**
 * Core business logic for the `/auth/mobile-callback` page.
 *
 * Returns a discriminated union describing what the page should do:
 *
 *   - `{ kind: "redirect", url }` — redirect the user to the deep link
 *   - `{ kind: "login" }` — redirect the user to the login page
 *   - `{ kind: "error", message }` — render an error page
 *
 * Preferred auth paths (checked in order):
 *  1. Cloudflare Access JWT (`CF_Authorization` cookie) — issues a fresh API
 *     key plus sends the CF token for subsequent API requests.
 *  2. NextAuth OIDC session cookie — sends the session cookie(s) so the app
 *     can replay them on subsequent requests.  No API key is created.
 *
 * ANTI-HIJACK STATE (remote-dev-gkuo): the `remotedev://` callback is a custom
 * scheme any app could register, so a malicious app could intercept the
 * credential payload. The Flutter app therefore generates a single-use,
 * high-entropy `state` per login attempt and passes it on the inbound
 * `/auth/mobile-callback?state=…` URL; we ECHO it unchanged on the deep link
 * (for ALL credential modes — CF / OIDC) so the app can reject any callback it
 * did not initiate. This is orthogonal to the credential type: it is purely an
 * unforgeable nonce. When `state` is absent (older app), we omit it — but an
 * updated app talks to updated servers, so a missing echo from an updated
 * server cannot happen (instance + supervisor both echo). See the matching
 * validation in `mobile/lib/infrastructure/auth/mobile_callback_login_launcher.dart`.
 *
 * @param opts.state - the app-supplied anti-hijack nonce to echo back, or
 *   `undefined` when the inbound request carried none.
 */
export async function resolveInstanceMobileCallback(opts?: {
  state?: string;
}): Promise<MobileCallbackResult> {
  const store = await cookies();
  const state = opts?.state;

  // ── Path 1: Cloudflare Access JWT ─────────────────────────────────────────
  const cfToken = store.get("CF_Authorization")?.value;
  if (cfToken) {
    const cfUser = await validateAccessJWT(cfToken);
    if (cfUser) {
      const user = await getOrCreateUserByEmail(cfUser.email);
      const apiKeyResult = await createApiKey(user.id, "Mobile App");
      log.info("Mobile API key issued via callback (CF)", { userId: user.id });
      return {
        kind: "redirect",
        url: deepLink({
          scope: "instance",
          apiKey: apiKeyResult.key,
          cfToken,
          authCookies: encodeAuthCookies([
            { name: "CF_Authorization", value: cfToken, path: "/" },
          ]),
          userId: user.id,
          email: user.email ?? "",
          state,
        }),
      };
    }
  }

  // ── Path 2: NextAuth OIDC session ─────────────────────────────────────────
  const session = await getAuthSession();
  if (session?.user?.id) {
    const name = getSessionCookieName();
    const authCookies = collectSessionCookies(store, name, COOKIE_PATH);
    if (authCookies.length > 0) {
      log.info("Mobile session credential issued via callback (OIDC)", {
        userId: session.user.id,
      });
      return {
        kind: "redirect",
        url: deepLink({
          scope: "instance",
          authCookies: encodeAuthCookies(authCookies),
          userId: session.user.id,
          email: session.user.email ?? "",
          state,
        }),
      };
    }
    log.warn("OIDC session resolved but session cookie not found in store", { name });
    // Falling through to /login would re-run OIDC and land back here (a loop):
    // an authenticated session with a missing cookie indicates a server
    // cookie-name misconfiguration, not an unauthenticated user. Surface an
    // ErrorPage instead (design §5.1).
    return {
      kind: "error",
      message: "Your session is missing its authentication cookie. Please sign in again.",
    };
  }

  return { kind: "login" };
}
