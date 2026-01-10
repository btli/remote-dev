import { auth } from "@/auth";
import { db } from "@/db";
import { authorizedUsers, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { validateAccessJWT } from "./cloudflare-access";

/**
 * Check if the request is from localhost (127.0.0.1 or ::1)
 * Used to restrict certain endpoints to local requests only for security.
 *
 * In production behind a reverse proxy (like Cloudflare), x-forwarded-for
 * will always be set to the real client IP, so non-localhost requests
 * will be properly rejected.
 */
export async function isLocalhostRequest(): Promise<boolean> {
  const headersList = await headers();

  // Check x-forwarded-for first (for proxied requests)
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    return firstIp === "127.0.0.1" || firstIp === "::1" || firstIp === "localhost";
  }

  // Check x-real-ip
  const realIp = headersList.get("x-real-ip");
  if (realIp) {
    return realIp === "127.0.0.1" || realIp === "::1" || realIp === "localhost";
  }

  // For direct connections, Next.js doesn't expose the remote IP in headers
  // but if we're here without x-forwarded-for, we're likely on localhost
  // In production behind Cloudflare, x-forwarded-for will always be set
  return true;
}

/**
 * Session-like object compatible with existing code that uses `await auth()`.
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Gets the CF Access token from request headers.
 * Works in both route handlers and server components.
 */
async function getCFTokenFromHeaders(): Promise<string | null> {
  const headersList = await headers();

  // Check Cf-Access-Jwt-Assertion header (set by Cloudflare)
  const headerToken = headersList.get("cf-access-jwt-assertion");
  if (headerToken) {
    return headerToken;
  }

  // Check CF_Authorization cookie (set by Cloudflare Access)
  const cookies = headersList.get("cookie");
  if (cookies) {
    const match = cookies.match(/CF_Authorization=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Drop-in replacement for `auth()` that supports both Cloudflare Access and NextAuth.
 *
 * Usage:
 * ```ts
 * // Instead of:
 * const session = await auth();
 *
 * // Use:
 * const session = await getAuthSession();
 * ```
 *
 * The returned session object is compatible with NextAuth's session structure.
 */
export async function getAuthSession(): Promise<AuthSession | null> {
  // Try Cloudflare Access first
  const cfToken = await getCFTokenFromHeaders();
  if (cfToken) {
    const cfUser = await validateAccessJWT(cfToken);
    if (cfUser) {
      // Check if user is authorized
      const authorized = await db.query.authorizedUsers.findFirst({
        where: eq(authorizedUsers.email, cfUser.email),
      });

      if (!authorized) {
        console.warn(`Unauthorized CF Access user: ${cfUser.email}`);
        return null;
      }

      // Get or create user in database
      let dbUser = await db.query.users.findFirst({
        where: eq(users.email, cfUser.email),
      });

      if (!dbUser) {
        const [newUser] = await db
          .insert(users)
          .values({
            email: cfUser.email,
            name: cfUser.email.split("@")[0],
          })
          .returning();
        dbUser = newUser;
      }

      return {
        user: {
          id: dbUser.id,
          email: dbUser.email!,
          name: dbUser.name,
        },
      };
    }
  }

  // Fall back to NextAuth session (local development)
  const session = await auth();
  if (session?.user?.id && session.user.email) {
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
      },
    };
  }

  return null;
}
