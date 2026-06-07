/**
 * Cloudflare Access JWT validation for the Supervisor's OWN application.
 *
 * Mirrors the root app's src/lib/cloudflare-access.ts (jose + remote JWKS), but
 * scoped to the Supervisor's distinct team/AUD env vars so access to the
 * Supervisor UI never implies access to an instance, and vice-versa.
 *
 * Duplicated here for workspace isolation. NOTE: promote to a shared package
 * once both the Supervisor and the instance app can depend on it.
 */

import { jwtVerify, createRemoteJWKSet } from "jose";

// Must NOT default to a real team — a wrong default fetches a foreign team's
// JWKS and breaks verification silently. Deployers set these explicitly.
const CF_ACCESS_TEAM = process.env.SUPERVISOR_CF_ACCESS_TEAM;
const CF_ACCESS_AUD = process.env.SUPERVISOR_CF_ACCESS_AUD;

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwksCache) {
    if (!CF_ACCESS_TEAM) {
      throw new Error(
        "SUPERVISOR_CF_ACCESS_TEAM is not configured; cannot build Cloudflare Access JWKS URL",
      );
    }
    jwksCache = createRemoteJWKSet(
      new URL(
        `https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`,
      ),
    );
  }
  return jwksCache;
}

export interface CloudflareAccessUser {
  email: string;
  /** Cloudflare user id (JWT `sub`). */
  sub: string;
  country?: string;
}

/** True when CF Access is configured (production). False in local dev. */
export function isCfAccessConfigured(): boolean {
  return Boolean(CF_ACCESS_AUD && CF_ACCESS_TEAM);
}

/**
 * Validate a Supervisor CF Access JWT and extract the user. Returns null when
 * the token is absent or invalid.
 *
 * When CF_ACCESS_AUD is unset (local dev), this returns null — callers fall
 * back to the SUPERVISOR_ADMIN_EMAIL local-dev path (see src/lib/auth.ts).
 */
export async function validateAccessJWT(
  token: string | null,
): Promise<CloudflareAccessUser | null> {
  if (!token) return null;

  // Without an AUD configured we are in local dev — do not trust unverified
  // tokens; let the caller use the explicit local-dev admin path instead.
  if (!CF_ACCESS_AUD || !CF_ACCESS_TEAM) return null;

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      audience: CF_ACCESS_AUD,
      issuer: `https://${CF_ACCESS_TEAM}.cloudflareaccess.com`,
    });
    // A verified token can still be a non-identity service token
    // (CF-Access-Client-Id/Secret): it carries `common_name` and NO `email`. It
    // clears the edge but must never mint a user session — return null so callers
    // fall through to OIDC / the local-dev admin path instead of resolving a user
    // with an empty email. (This module runs in the Edge proxy boundary, so it
    // mirrors the root app's console-free, silent-null convention here.)
    if (
      typeof payload.email !== "string" ||
      payload.email.length === 0 ||
      typeof payload.sub !== "string"
    ) {
      return null;
    }
    return {
      email: payload.email,
      sub: payload.sub,
      country: payload.country as string | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the CF Access JWT from a request: the `Cf-Access-Jwt-Assertion`
 * header (preferred) or the `CF_Authorization` cookie.
 */
export function getAccessToken(request: Request): string | null {
  const headerToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (headerToken) return headerToken;

  const cookies = request.headers.get("cookie");
  if (cookies) {
    const match = cookies.match(/CF_Authorization=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}
