import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateAccessJWT,
  getAccessToken,
} from "@/lib/cloudflare-access";

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

  // No CF Access token - fall back to NextAuth for local development
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
