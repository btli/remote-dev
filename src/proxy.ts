import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateAccessJWT,
  getAccessToken,
} from "@/lib/cloudflare-access";
import { getSessionCookieName } from "@/lib/auth-cookies";
import { INSTANCE_SLUG, prefixPath } from "@/lib/base-path";

/**
 * Proxy handler for authentication at the network boundary.
 * Handles auth via either:
 * 1. Cloudflare Access JWT (production via tunnel)
 * 2. NextAuth session (local development)
 *
 * Note: Renamed from middleware to proxy per Next.js 16 conventions.
 * See: https://nextjs.org/docs/messages/middleware-to-proxy
 */
/**
 * Tag every response with the instance slug when running in multi-instance
 * mode. Operators / external probes use this header to disambiguate which
 * pod served a request when many sit behind the same Cloudflare tunnel.
 *
 * No-op when `RDV_INSTANCE_SLUG` (and therefore `INSTANCE_SLUG`) is empty,
 * preserving byte-identical responses for single-tenant deployments (AC-1).
 */
function tagInstance(response: NextResponse): NextResponse {
  if (INSTANCE_SLUG) response.headers.set("x-rdv-instance", INSTANCE_SLUG);
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Always allow static assets and PWA files
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons/")
  ) {
    return tagInstance(NextResponse.next());
  }

  // Always allow NextAuth routes (needed for local dev)
  if (pathname.startsWith("/api/auth/")) {
    return tagInstance(NextResponse.next());
  }

  // Allow K8s health probes (kubelets call these without auth). The bare
  // unprefixed pathname is what Next.js exposes after stripping the
  // basePath, so this matches both `/api/healthz` and `/alpha/api/healthz`.
  if (pathname === "/api/healthz" || pathname === "/api/readyz") {
    return tagInstance(NextResponse.next());
  }

  // Allow deploy webhook + its status endpoint (both use their own
  // HMAC-SHA256 auth; the status poll is read-only). The bare unprefixed
  // pathname is what Next.js exposes after stripping basePath, so this matches
  // both `/api/deploy/status` and `/<prefix>/api/deploy/status`.
  if (pathname === "/api/deploy" || pathname === "/api/deploy/status") {
    return tagInstance(NextResponse.next());
  }

  // Check for Cloudflare Access JWT first
  const cfToken = getAccessToken(request);
  if (cfToken) {
    const cfUser = await validateAccessJWT(cfToken);
    if (cfUser) {
      // Valid CF Access token - allow request
      // User authorization is checked in route handlers via getCurrentUser()
      const response = NextResponse.next();
      // Pass user info to route handlers via headers
      response.headers.set("x-cf-user-email", cfUser.email);
      response.headers.set("x-cf-user-id", cfUser.sub);
      return tagInstance(response);
    }
    // Invalid CF token - reject
    return tagInstance(
      NextResponse.json(
        { error: "Invalid Cloudflare Access token" },
        { status: 401 }
      )
    );
  }

  // No CF Access token - fall back to NextAuth for local development.
  //
  // `getToken()` reads its cookie by name; under `RDV_BASE_PATH` we rename the
  // session cookie (see src/lib/auth-cookies.ts) so the default name
  // `__Secure-authjs.session-token` is no longer present and `getToken()` would
  // silently return null — every API call would 401. Always pass the configured
  // name so this path keeps working in both single-server and multi-instance
  // deployments. (Gemini review: critical.)
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    cookieName: getSessionCookieName(),
  });

  const isLoggedIn = !!token;
  const isLoginPage = pathname === "/login";
  const isApiRoute = pathname.startsWith("/api");

  // Protect API routes
  if (isApiRoute) {
    // Allow API key auth to pass through to route handlers (Bearer token validation happens there)
    const hasApiKeyHeader = request.headers
      .get("authorization")
      ?.startsWith("Bearer ");
    if (!isLoggedIn && !hasApiKeyHeader) {
      return tagInstance(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
    return tagInstance(NextResponse.next());
  }

  // Protect pages.
  //
  // Next.js strips the deployment prefix (`/alpha`) from `request.url` before
  // the proxy runs, so `new URL("/login", request.url)` would build
  // `https://host/login` — which 404s under `RDV_BASE_PATH=/alpha`. Use
  // `prefixPath()` to put the prefix back on every Location header.
  if (!isLoggedIn && !isLoginPage) {
    return tagInstance(
      NextResponse.redirect(new URL(prefixPath("/login"), request.url))
    );
  }

  if (isLoggedIn && isLoginPage) {
    return tagInstance(
      NextResponse.redirect(new URL(prefixPath("/"), request.url))
    );
  }

  // Pass pathname to the root layout (request headers) so it can skip
  // heavy providers on /login. See src/app/layout.tsx.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return tagInstance(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
