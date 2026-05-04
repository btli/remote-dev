import { jwtVerify, createRemoteJWKSet } from "jose";

// Cloudflare Access configuration
// Note: This module uses console.warn/error directly because it runs in Edge
// runtime (via proxy.ts) where the structured logger is not available.
//
// `CF_ACCESS_TEAM` MUST NOT default to a hardcoded team name. Defaulting to
// any real tenant would silently fetch JWKS from a foreign team's domain
// during JWT verification — verification would then fail (different signing
// keys) and, worse, the logout flow in `src/app/api/auth/signout/route.ts`
// would redirect users to that foreign team's login wall. Both issues lead
// to silent auth failures that are very hard to debug. We therefore require
// the deployer to set `CF_ACCESS_TEAM` explicitly when CF Access is in use.
const CF_ACCESS_TEAM = process.env.CF_ACCESS_TEAM;
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD;

// Cache the JWKS for performance
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwksCache) {
    if (!CF_ACCESS_TEAM) {
      throw new Error(
        "CF_ACCESS_TEAM is not configured; cannot build Cloudflare Access JWKS URL"
      );
    }
    jwksCache = createRemoteJWKSet(
      new URL(`https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)
    );
  }
  return jwksCache;
}

export interface CloudflareAccessUser {
  email: string;
  sub: string; // Cloudflare user ID
  country?: string;
}

/**
 * Validates a Cloudflare Access JWT and extracts user information.
 * Returns null if validation fails or if running in local development without CF Access.
 */
export async function validateAccessJWT(
  token: string | null
): Promise<CloudflareAccessUser | null> {
  if (!token) {
    return null;
  }

  // In development without CF_ACCESS_AUD, skip validation but still decode
  if (!CF_ACCESS_AUD) {
    console.warn("[CloudflareAccess] CF_ACCESS_AUD not set - skipping JWT signature validation");
    try {
      // Decode without verification for local development (Edge-compatible)
      const [, payloadBase64] = token.split(".");
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
      return {
        email: payload.email,
        sub: payload.sub,
        country: payload.country,
      };
    } catch {
      return null;
    }
  }

  if (!CF_ACCESS_TEAM) {
    console.error(
      "[CloudflareAccess] CF_ACCESS_AUD set but CF_ACCESS_TEAM missing; refusing to verify JWT"
    );
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      audience: CF_ACCESS_AUD,
      issuer: `https://${CF_ACCESS_TEAM}.cloudflareaccess.com`,
    });

    return {
      email: payload.email as string,
      sub: payload.sub as string,
      country: payload.country as string | undefined,
    };
  } catch (error) {
    console.error("[CloudflareAccess] CF Access JWT validation failed", { error: String(error) });
    return null;
  }
}

/**
 * Extracts the Cloudflare Access JWT from request headers.
 * The JWT can be in either the Cf-Access-Jwt-Assertion header or CF_Authorization cookie.
 */
export function getAccessToken(request: Request): string | null {
  // Check header first (preferred)
  const headerToken = request.headers.get("Cf-Access-Jwt-Assertion");
  if (headerToken) {
    return headerToken;
  }

  // Fall back to cookie
  const cookies = request.headers.get("cookie");
  if (cookies) {
    const match = cookies.match(/CF_Authorization=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}
