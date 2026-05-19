import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateAccessJWT,
  getAccessToken,
} from "@/lib/cloudflare-access";
import { getSessionCookieName } from "@/lib/auth-cookies";

/**
 * Proxy handler for authentication at the network boundary.
 * Handles auth via either:
 * 1. Cloudflare Access JWT (production via tunnel)
 * 2. NextAuth session (local development)
 *
 * Note: Renamed from middleware to proxy per Next.js 16 conventions.
 * See: https://nextjs.org/docs/messages/middleware-to-proxy
 */
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
    return NextResponse.next();
  }

  // Always allow NextAuth routes (needed for local dev)
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow deploy webhook (uses its own HMAC-SHA256 auth)
  if (pathname === "/api/deploy") {
    return NextResponse.next();
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
      return response;
    }
    // Invalid CF token - reject
    return NextResponse.json(
      { error: "Invalid Cloudflare Access token" },
      { status: 401 }
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Protect pages
  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Pass pathname to the root layout (request headers) so it can skip
  // heavy providers on /login. See src/app/layout.tsx.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
