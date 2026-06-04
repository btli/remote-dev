import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateAccessJWT,
  getAccessToken,
} from "@/lib/cloudflare-access";
import {
  getSessionCookieName,
  hasSessionCookie,
} from "@/lib/auth-cookies";
import { INSTANCE_SLUG, prefixPath } from "@/lib/base-path";
import { resolveExternalOrigin } from "@/lib/request-origin";
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

  // [aehq] Model-key proxy: the forward endpoint authenticates with its own
  // per-session token (`mp_…`), not a browser session or CF JWT, so let it
  // bypass this gate. `/api/model-proxy/tokens*` is DELIBERATELY excluded — it
  // is the browser/`withApiAuth` issuance surface and stays behind the gate.
  if (
    pathname.startsWith("/api/model-proxy/") &&
    !pathname.startsWith("/api/model-proxy/tokens")
  ) {
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
    const presentNames = request.cookies.getAll().map((c) => c.name);
    isLoggedIn = hasSessionCookie(presentNames);
    log.debug(
      "scoped instance proxy realm; using session-cookie presence gate (getToken is unreliable here)",
      { isLoggedIn, presentCount: presentNames.length, pathname },
    );
  } else {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      cookieName: getSessionCookieName(),
    });
    isLoggedIn = !!token;
  }

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
  // Build redirect Locations against the EXTERNAL origin (edge-forwarded
  // Host/proto), NOT `request.url`. In production single-server SOCKET mode
  // `request.url` is the internal `http://localhost:<random>` that
  // standalone-server.js binds behind the Cloudflare tunnel, so an absolute
  // redirect built from it leaks that dead internal address into the Location.
  // NextResponse.redirect requires an absolute URL (a relative Location throws
  // at runtime), so we resolve the real origin instead. `prefixPath()` still
  // re-adds the deployment prefix (`/alpha`) that Next strips from request.url.
  const redirectOrigin = resolveExternalOrigin(
    (name) => request.headers.get(name),
    request.nextUrl.origin,
  );
  if (!isLoggedIn && !isLoginPage) {
    return tagInstance(
      NextResponse.redirect(new URL(prefixPath("/login"), redirectOrigin))
    );
  }

  // Only auto-redirect away from /login when isLoggedIn is a REAL validation
  // signal (unscoped/single-server getToken). In scoped instance mode isLoggedIn
  // is mere cookie-PRESENCE, so a stale/invalid session cookie would bounce
  // /login→/ while the Home page's real getAuthSession() bounces /→/login → an
  // infinite loop. Let /login render instead; re-authenticating overwrites the
  // stale cookie. (Unauthenticated /dev→/login redirect above is unaffected.)
  if (isLoggedIn && isLoginPage && !scoped) {
    return tagInstance(
      NextResponse.redirect(new URL(prefixPath("/"), redirectOrigin))
    );
  }

  // Pass pathname to the root layout (request headers) so it can skip
  // heavy providers on /login. See src/app/layout.tsx.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return tagInstance(
    NextResponse.next({ request: { headers: requestHeaders } })
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
