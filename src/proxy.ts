import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateAccessJWT,
  getAccessToken,
} from "@/lib/cloudflare-access";
import {
  getSessionCookieName,
  getSessionCookieNameCandidates,
} from "@/lib/auth-cookies";
import { INSTANCE_SLUG, prefixPath } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";

const log = createLogger("proxy");

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

  // No CF Access token - fall back to NextAuth.
  //
  // We branch on whether we're running SCOPED (a standalone instance pod under
  // `RDV_BASE_PATH`) or UNSCOPED (single-server / local dev / single-host prod).
  // The discriminator is `INSTANCE_SLUG` (derived from the build-inlined
  // BASE_PATH, so it IS reliable in the proxy realm). This matches
  // `isUnscopedMode()` in src/lib/auth-cookies.ts: unscoped ⇔ INSTANCE_SLUG === "".
  //
  // 1. UNSCOPED (single-server): do the full cryptographic validation via
  //    `getToken()`. It reads its cookie by name; we always pass the configured
  //    name. The main Node server captured `process.env.AUTH_SECRET`/`AUTH_URL`,
  //    so the secret and the cookie-name prefix are both correct here and crypto
  //    validation works. This path is byte-identical to before (AC-1).
  //
  // 2. SCOPED (the Next standalone *instance proxy* realm): the middleware realm
  //    cannot reliably run `getToken()`. It has neither the container's runtime
  //    `process.env.AUTH_SECRET` (it is absent — or, worse, spuriously truthy —
  //    and not the value the Node server actually signed with) nor a usable
  //    `process.env.AUTH_URL` (empty → it would compute the UNPREFIXED cookie
  //    name while the real cookie is `__Secure-`-prefixed). Either way
  //    `getToken()` returns null for a valid session and OIDC login loops
  //    (proven in-pod). So gate on session-cookie PRESENCE instead: treat the
  //    request as logged-in if EITHER candidate scoped cookie name is present.
  //    Real authorization is still enforced server-side (route handlers / server
  //    components via `getCurrentUser()`), which DO have the secret — the edge
  //    only needs a presence gate here.
  const scoped = INSTANCE_SLUG.length > 0;
  let isLoggedIn: boolean;
  if (scoped) {
    const candidates = getSessionCookieNameCandidates();
    isLoggedIn = candidates.some((name) => request.cookies.has(name));
    log.debug(
      "scoped instance proxy realm; using session-cookie presence gate (getToken is unreliable here)",
      { isLoggedIn, candidateCount: candidates.length, pathname },
    );
  } else {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      cookieName: getSessionCookieName(),
    });
    isLoggedIn = !!token;
  }

  // TEMP DEBUG (remove): surface what the proxy realm actually sees so a single
  // in-pod probe of /dev (with and without a session cookie) can confirm the
  // gate decision. NAMES + booleans only — never cookie/secret VALUES.
  const dbgHeaders: Record<string, string> = {
    "x-rdv-dbg-mode": scoped ? "scoped" : "unscoped",
    "x-rdv-dbg-loggedin": String(isLoggedIn),
    "x-rdv-dbg-secret": process.env.AUTH_SECRET ? "present" : "absent",
    "x-rdv-dbg-cookies": request.cookies
      .getAll()
      .map((c) => c.name)
      .join(","),
    "x-rdv-dbg-candidates": getSessionCookieNameCandidates().join(","),
  };
  const tagDebug = (response: NextResponse): NextResponse => {
    for (const [k, v] of Object.entries(dbgHeaders)) response.headers.set(k, v);
    return response;
  };

  const isLoginPage = pathname === "/login";
  const isApiRoute = pathname.startsWith("/api");

  // Protect API routes
  if (isApiRoute) {
    // Allow API key auth to pass through to route handlers (Bearer token validation happens there)
    const hasApiKeyHeader = request.headers
      .get("authorization")
      ?.startsWith("Bearer ");
    if (!isLoggedIn && !hasApiKeyHeader) {
      return tagDebug(
        tagInstance(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        )
      );
    }
    return tagDebug(tagInstance(NextResponse.next()));
  }

  // Protect pages.
  //
  // Next.js strips the deployment prefix (`/alpha`) from `request.url` before
  // the proxy runs, so `new URL("/login", request.url)` would build
  // `https://host/login` — which 404s under `RDV_BASE_PATH=/alpha`. Use
  // `prefixPath()` to put the prefix back on every Location header.
  if (!isLoggedIn && !isLoginPage) {
    return tagDebug(
      tagInstance(
        NextResponse.redirect(new URL(prefixPath("/login"), request.url))
      )
    );
  }

  if (isLoggedIn && isLoginPage) {
    return tagDebug(
      tagInstance(
        NextResponse.redirect(new URL(prefixPath("/"), request.url))
      )
    );
  }

  // Pass pathname to the root layout (request headers) so it can skip
  // heavy providers on /login. See src/app/layout.tsx.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return tagDebug(
    tagInstance(NextResponse.next({ request: { headers: requestHeaders } }))
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
