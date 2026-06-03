/**
 * RDV_BASE_PATH audit (2026-05-19): no changes needed in this file.
 *
 * - Cloudflare Access JWT validation is hostname-scoped at the Cloudflare edge
 *   (CF_ACCESS_TEAM + CF_ACCESS_AUD), not path-scoped. The same JWT is valid
 *   across all paths on the host, so multi-instance basePath has no effect on
 *   this code path.
 * - The CF token is read from the `cf-access-jwt-assertion` header or
 *   `CF_Authorization` cookie — both are present regardless of which prefix
 *   the request hit.
 * - This module does not construct any absolute URLs and does not read cookies
 *   by NextAuth's scoped names (that is handled inside NextAuth itself, via
 *   the config in `src/auth.ts` + `src/lib/auth-cookies.ts`).
 */
import { auth } from "@/auth";
import { db } from "@/db";
import { authorizedUsers, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { validateAccessJWT } from "./cloudflare-access";
import { createLogger } from "@/lib/logger";
import { getOrCreateUserByEmail, ensurePrimaryUserEmail } from "@/lib/user-identity";

const log = createLogger("Auth");

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
        log.warn("Unauthorized CF Access user", { email: cfUser.email });
        return null;
      }

      // Resolve via the multi-email index so ANY of the user's emails — primary
      // or secondary — maps back to the same account. Creates a new user (+
      // primary user_email row) only when the email is unknown to every user.
      const dbUser = await getOrCreateUserByEmail(cfUser.email);

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
    // Verify user exists in database (JWT tokens persist but DB may be reset).
    // The JWT id is authoritative here, so resolve by id first. Select only the
    // columns used below so the type lines up with the helper's return shape.
    let dbUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { id: true, email: true, name: true },
    });

    // If user doesn't exist but email is authorized, create them — preserving
    // the JWT id so the existing session stays valid — via the multi-email
    // helper so a primary user_email row is seeded alongside the user.
    if (!dbUser && session.user.email) {
      const authorized = await db.query.authorizedUsers.findFirst({
        where: eq(authorizedUsers.email, session.user.email),
      });

      if (authorized) {
        dbUser = await getOrCreateUserByEmail(
          session.user.email,
          session.user.name ?? null,
          session.user.id // Preserve the ID from JWT to avoid session invalidation
        );
      }
    } else if (dbUser?.email) {
      // Pre-existing user touched via the JWT path: make sure its primary
      // email is present in the resolution index (covers users created before
      // this feature shipped, in case the boot backfill hasn't run yet).
      // Idempotent — UNIQUE(email) makes a duplicate a no-op.
      await ensurePrimaryUserEmail(dbUser.id, dbUser.email);
    }

    if (!dbUser) {
      log.warn("User from JWT not found in database and email not authorized", { userId: session.user.id });
      return null;
    }

    return {
      user: {
        id: dbUser.id,
        email: dbUser.email!,
        name: dbUser.name,
      },
    };
  }

  return null;
}
