import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge auth boundary for the Supervisor UI (mirrors the root app's
 * `src/proxy.ts`; renamed from `middleware` per Next.js 16 conventions).
 *
 * SCOPE: this is coarse, Edge-safe, defense-in-depth ONLY. It is NOT the
 * authoritative verifier and is NOT a substitute for server-side auth. The
 * route/page layer MUST verify the CF Access JWT signature/claims via
 * `validateAccessJWT` + `resolveSupervisorUser` (API routes do this through
 * `withSupervisorAuth`; the dashboard page resolves the user server-side).
 * It MUST NOT import the DB (`@libsql/client` is not Edge-compatible) or the
 * role layer. Here we only:
 *   - always allow static assets, the health route, and the favicon;
 *   - in production (CF Access configured) require a *structurally-plausible*
 *     CF Access JWT to be PRESENT (header or cookie) for page routes — this
 *     just rejects obviously-missing/garbage tokens early; the real signature
 *     check happens server-side;
 *   - in local dev (no CF Access), allow through — `withSupervisorAuth` uses
 *     SUPERVISOR_ADMIN_EMAIL as the identity.
 *
 * API routes are intentionally NOT redirected here; they self-gate and return
 * JSON 401/403, which is the correct behavior for programmatic callers.
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

export function proxy(request: NextRequest): NextResponse {
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

  // API routes self-gate via withSupervisorAuth (JSON 401/403). Don't redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Production: a CF Access app gates this hostname. Require the assertion to be
  // present for page routes; the actual signature check happens server-side.
  const cfConfigured = Boolean(
    process.env.SUPERVISOR_CF_ACCESS_AUD &&
      process.env.SUPERVISOR_CF_ACCESS_TEAM,
  );
  if (cfConfigured && !hasCfAssertion(request)) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
