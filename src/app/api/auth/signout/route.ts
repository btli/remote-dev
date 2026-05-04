/**
 * Mobile-aware sign-out endpoint.
 *
 * The mobile sign-out flow needs to handle BOTH authentication paths:
 *
 *   1. NextAuth credentials (localhost dev) — clear the NextAuth JWT
 *      session cookie via {@link signOut}.
 *   2. Cloudflare Access (remote/LAN production) — the `CF_Authorization`
 *      cookie is set by Cloudflare Access on a domain we don't control.
 *      The only way to clear it is to redirect the browser through
 *      Cloudflare Access's own logout URL: it deletes the cookie and
 *      bounces back to a return URL we provide.
 *
 * The default mobile sign-out previously called the next-auth client
 * `signOut()` only. For CF Access users that call is a no-op — they
 * stayed authenticated. This endpoint fixes that by clearing both
 * sessions, then redirecting through CF logout when configured.
 *
 * Method allow-list: POST only.
 *
 * GET is intentionally not exported. A GET handler would make sign-out a
 * trivially-exploitable CSRF logout vector — an attacker could embed
 * `<img src="https://app/api/auth/signout">` on a third-party page and
 * sign the user out. POST is not auto-triggered from external GET-only
 * contexts (no `<img>`, no `<a href>`, no `<script src>`).
 *
 * As a defense-in-depth measure the POST handler also verifies that the
 * `Origin` (or `Referer`) header is same-origin with the request host,
 * rejecting cross-origin POSTs.
 */

import { NextResponse, type NextRequest } from "next/server";

import { signOut } from "@/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/signout");

function buildLoginUrl(request: NextRequest): string {
  const origin = process.env.NEXTAUTH_URL || request.nextUrl.origin;
  return `${origin.replace(/\/$/, "")}/login`;
}

/**
 * Returns the Cloudflare Access logout URL that will clear the
 * `CF_Authorization` cookie on the team domain and redirect back to
 * `returnTo`. Returns `null` when CF Access is not configured (i.e.
 * pure localhost dev) — callers should redirect straight to /login.
 *
 * Both `CF_ACCESS_AUD` and `CF_ACCESS_TEAM` are required. If `AUD` is
 * set without `TEAM` we explicitly fall through (rather than guessing a
 * default team) — guessing would silently redirect users to a foreign
 * tenant's `*.cloudflareaccess.com` domain, which CANNOT clear our
 * cookie and would leave sign-out in a broken state.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/#log-out-of-an-application
 */
function buildCloudflareLogoutUrl(returnTo: string): string | null {
  if (!process.env.CF_ACCESS_AUD) {
    // CF Access is not enforced in this environment.
    return null;
  }
  const team = process.env.CF_ACCESS_TEAM;
  if (!team) {
    log.error(
      "CF_ACCESS_AUD set but CF_ACCESS_TEAM not configured; skipping CF logout redirect"
    );
    return null;
  }
  const url = new URL(
    `https://${team}.cloudflareaccess.com/cdn-cgi/access/logout`
  );
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

/**
 * Verifies the request originates from the same site this route is
 * served from. Rejects cross-origin POSTs to harden against any
 * future-form-submission CSRF angle. We accept either `Origin` (set by
 * fetch / form POSTs from a browser) or `Referer` (older clients).
 *
 * Returns `true` when the request is same-origin OR when neither header
 * is present *and* the request looks like a server-to-server call (no
 * `User-Agent` resembling a browser). The conservative branch — header
 * present but mismatched — always rejects.
 */
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) {
    // No host header: treat as untrusted.
    return false;
  }
  const expected = `${request.nextUrl.protocol}//${host}`.replace(/\/$/, "");
  const origin = request.headers.get("origin");
  if (origin) {
    return origin.replace(/\/$/, "") === expected;
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      return `${refUrl.protocol}//${refUrl.host}` === expected;
    } catch {
      return false;
    }
  }
  // Neither header present. Browsers always send one or the other on
  // POST, so the absence implies a non-browser caller (curl, server). We
  // err toward allowing it: such callers are not the CSRF attack surface.
  return true;
}

async function handleSignOut(request: NextRequest): Promise<NextResponse> {
  const loginUrl = buildLoginUrl(request);

  // Clear the NextAuth session FIRST so the credentials path is
  // logged out even if the CF redirect fails or is intercepted.
  try {
    await signOut({ redirect: false });
  } catch (err) {
    // signOut throws a NEXT_REDIRECT internally when redirect is true.
    // With redirect:false this should be safe, but log defensively.
    log.warn("NextAuth signOut threw", { error: String(err) });
  }

  const cfLogout = buildCloudflareLogoutUrl(loginUrl);
  if (cfLogout) {
    log.info("Redirecting to Cloudflare Access logout", { returnTo: loginUrl });
    return NextResponse.redirect(cfLogout);
  }

  log.info("Redirecting to login (no CF Access configured)");
  return NextResponse.redirect(loginUrl);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    log.warn("Rejected cross-origin sign-out POST", {
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
    });
    return NextResponse.json(
      { error: "Cross-origin sign-out is not permitted" },
      { status: 403 }
    );
  }
  return handleSignOut(request);
}
