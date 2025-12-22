import { jwtVerify, createRemoteJWKSet } from "jose";

// Cloudflare Access configuration
const CF_ACCESS_TEAM = process.env.CF_ACCESS_TEAM || "joyfulhouse";
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD;

// Cache the JWKS for performance
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwksCache) {
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
    console.warn("CF_ACCESS_AUD not set - skipping JWT signature validation");
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
    console.error("CF Access JWT validation failed:", error);
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
