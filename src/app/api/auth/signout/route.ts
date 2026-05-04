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
 * GET is supported so a `<a href>` or `window.location.href` from the
 * client triggers the full redirect chain without the browser blocking
 * a fetch-driven cross-origin redirect.
 */

import { NextResponse, type NextRequest } from "next/server";

import { signOut } from "@/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth/signout");

const CF_ACCESS_TEAM = process.env.CF_ACCESS_TEAM || "joyfulhouse";

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
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/#log-out-of-an-application
 */
function buildCloudflareLogoutUrl(returnTo: string): string | null {
  if (!process.env.CF_ACCESS_AUD) {
    // CF Access is not enforced in this environment.
    return null;
  }
  const url = new URL(
    `https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/logout`
  );
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleSignOut(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSignOut(request);
}
