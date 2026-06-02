import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getSessionCookieName, isSecureAuthScheme } from "@/lib/session-cookie";

/**
 * Edge auth boundary for the Supervisor UI (mirrors the root app's
 * `src/proxy.ts`; renamed from `middleware` per Next.js 16 conventions).
 *
 * SCOPE: this is coarse, defense-in-depth ONLY. It is NOT the authoritative
 * verifier and is NOT a substitute for server-side auth. The route/page layer
 * MUST verify the CF Access JWT signature/claims via `validateAccessJWT` +
 * `resolveSupervisorUser` (API routes do this through `withSupervisorAuth`; the
 * pages resolve the user server-side via `getCurrentUser`). It MUST NOT import
 * the DB (`@libsql/client` is not Edge-compatible), the role layer, or `@/auth`
 * (NextAuth + DB). The cookie-name helper it imports is dependency-free. Here we:
 *   - always allow static assets, the health route, the favicon, the login page
 *     (`/login`), and the NextAuth endpoints (`/api/auth/*`) — the login flow
 *     must be reachable with no auth;
 *   - allow a page route through when EITHER a structurally-plausible CF Access
 *     JWT is present (header/cookie) OR a valid NextAuth session cookie exists
 *     (DUAL AUTH). `getToken` is DB-free and proxy-safe (it only verifies the
 *     JWT cookie with AUTH_SECRET);
 *   - when OIDC is configured but CF is not, REDIRECT unauthenticated page
 *     routes to `/login` (the OIDC-only edge gate);
 *   - in local dev (neither CF Access nor OIDC configured), allow through —
 *     `withSupervisorAuth` / `getCurrentUser` use SUPERVISOR_ADMIN_EMAIL.
 *
 * API routes (other than `/api/auth/*`) are intentionally NOT redirected here;
 * they self-gate and return JSON 401/403, the correct behavior for programmatic
 * callers.
 */

/** A token is structurally JWT-plausible: three non-empty dot-separated parts. */
function looksLikeJwt(token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function hasCfAssertion(request: NextRequest): boolean {
  if (looksLikeJwt(request.headers.get("cf-access-jwt-assertion"))) return true;
  const cookie = request.headers.get("cookie");
  const match = cookie?.match(/CF_Authorization=([^;]+)/);
  return looksLikeJwt(match?.[1]);
}

/**
 * True when a valid NextAuth session JWT cookie is present (DB-free check).
 *
 * We MUST pass the exact `cookieName` + `secureCookie` that `auth()` used.
 * `getToken`'s defaults derive the cookie name from `secureCookie ?? false`
 * (i.e. the NON-secure name), so on prod HTTPS — where the cookie is
 * `__Secure-authjs.session-token` — the default would miss it and silently
 * reject every OIDC session. `getToken` also defaults `salt = cookieName`, and
 * the JWE is decrypted with that salt, so the name must match for decryption too.
 */
async function hasNextAuthSession(request: NextRequest): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  try {
    const secureCookie = isSecureAuthScheme(request);
    const cookieName = getSessionCookieName(request);
    const token = await getToken({ req: request, secret, secureCookie, cookieName });
    return token !== null && token !== undefined;
  } catch {
    return false;
  }
}

/** Redirect to /login, preserving the original path as `?callbackUrl=` for post-login return. */
function redirectToLogin(request: NextRequest): NextResponse {
  // Build from `request.url` (always a string) rather than `nextUrl.clone()` so
  // the same-origin redirect target is constructed without relying on NextURL.
  const url = new URL(request.url);
  const callbackUrl = url.pathname + url.search;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Static assets + favicon + health probe always pass.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  // The login page and the NextAuth endpoints must be reachable WITHOUT any
  // auth — they are how an unauthenticated user signs in via OIDC.
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Other API routes self-gate via withSupervisorAuth (JSON 401/403).
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Page routes. Pass when EITHER a CF Access assertion is present OR a valid
  // NextAuth session cookie exists. When CF is configured, the assertion is the
  // fast path; a native-OIDC user has no CF token, so also accept the session.
  const cfConfigured = Boolean(
    process.env.SUPERVISOR_CF_ACCESS_AUD &&
      process.env.SUPERVISOR_CF_ACCESS_TEAM,
  );

  if (cfConfigured) {
    if (hasCfAssertion(request)) return NextResponse.next();
    if (await hasNextAuthSession(request)) return NextResponse.next();
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  // CF not configured. If OIDC IS configured, this is an OIDC-only deploy — give
  // page routes a real edge gate: pass with a valid session, else redirect to
  // /login (rather than leaking the page to an anonymous user).
  const oidcConfigured = Boolean(process.env.AUTH_SECRET);
  if (oidcConfigured) {
    if (await hasNextAuthSession(request)) return NextResponse.next();
    return redirectToLogin(request);
  }

  // Neither CF nor OIDC (local dev). Allow through — server-side resolves the
  // identity (the SUPERVISOR_ADMIN_EMAIL dev fallback).
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
