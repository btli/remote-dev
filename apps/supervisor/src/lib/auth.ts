/**
 * withSupervisorAuth — role-gated auth wrapper for Supervisor API routes.
 *
 * Mirrors the root app's `withApiAuth` (src/lib/api.ts) and adds a role gate
 * (spec §6.6). Resolution order:
 *   1. Production: validate the Supervisor's own CF Access JWT (src/lib/cf-access.ts).
 *   2. Local dev (no CF Access AUD configured): fall back to SUPERVISOR_ADMIN_EMAIL,
 *      mirroring the main app's localhost credentials path.
 * The authenticated email is resolved to (or created as) a `supervisor_user`
 * row; the first admin is seeded from SUPERVISOR_ADMIN_EMAIL. The handler then
 * runs only if the user holds at least `requiredRole`.
 *
 * On failure: 401 (no/!valid identity) or 403 (authenticated but under-privileged),
 * both as JSON.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { supervisorUser } from "@/db/schema";
import type { SupervisorUserRow } from "@/db/schema";
import { hasRole, isRole, type Role } from "@/lib/roles";
import {
  validateAccessJWT,
  getAccessToken,
  isCfAccessConfigured,
} from "@/lib/cf-access";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/auth");

/** Route context for dynamic routes — params are a Promise in Next.js 16. */
export interface RouteContext {
  params?: Promise<Record<string, string>>;
}

/** Context passed to a wrapped handler. */
export interface SupervisorAuthContext {
  user: SupervisorUserRow;
  params?: Record<string, string>;
}

type Handler = (
  request: Request,
  context: SupervisorAuthContext,
) => Promise<NextResponse> | NextResponse;

/**
 * Resolve the authenticated email for this request, or null.
 * Exported for unit testing the precedence rules.
 */
export async function resolveAuthenticatedEmail(
  request: Request,
): Promise<string | null> {
  // Production path: a valid CF Access JWT for the Supervisor's own app.
  if (isCfAccessConfigured()) {
    const token = getAccessToken(request);
    const cfUser = await validateAccessJWT(token);
    return cfUser?.email ?? null;
  }

  // Belt-and-suspenders: NEVER trust the admin-email fallback in production.
  // The startup guard in src/instrumentation.ts already refuses to boot prod
  // without CF Access, but defend here too in case that guard is bypassed (or
  // a future entry point skips instrumentation). The explicit escape hatch
  // SUPERVISOR_ALLOW_INSECURE_AUTH=1 re-enables the fallback for testing only.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SUPERVISOR_ALLOW_INSECURE_AUTH !== "1"
  ) {
    return null;
  }

  // Local-dev path: no CF Access configured → trust SUPERVISOR_ADMIN_EMAIL as
  // the operator identity (mirrors the main app's localhost credentials path).
  const adminEmail = process.env.SUPERVISOR_ADMIN_EMAIL;
  return adminEmail && adminEmail.length > 0 ? adminEmail : null;
}

/**
 * Get the supervisor_user for `email`, creating it on first sight. The very
 * first user matching SUPERVISOR_ADMIN_EMAIL is seeded as `admin`; everyone
 * else defaults to `viewer` until an admin promotes them.
 */
export async function resolveSupervisorUser(
  email: string,
): Promise<SupervisorUserRow> {
  const existing = await db.query.supervisorUser.findFirst({
    where: eq(supervisorUser.email, email),
  });
  if (existing) return existing;

  const adminEmail = process.env.SUPERVISOR_ADMIN_EMAIL;
  const role: Role = adminEmail && email === adminEmail ? "admin" : "viewer";

  // Idempotent insert: concurrent first-sight requests can both miss findFirst
  // and race to insert the same email. onConflictDoUpdate makes the loser a
  // benign no-op (touch updatedAt) that PRESERVES the existing role — a racing
  // insert must never downgrade an already-seeded admin to viewer.
  const [created] = await db
    .insert(supervisorUser)
    .values({ email, role })
    .onConflictDoUpdate({
      target: supervisorUser.email,
      set: { updatedAt: new Date() },
    })
    .returning();
  if (created) {
    log.info("Resolved supervisor user", { email, role: created.role });
    return created;
  }

  // Extremely defensive: some drivers can return an empty RETURNING set on a
  // conflict no-op — re-query to be safe.
  return (await db.query.supervisorUser.findFirst({
    where: eq(supervisorUser.email, email),
  }))!;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized", code: "UNAUTHORIZED" },
    { status: 401 },
  );
}

function forbidden(required: Role): NextResponse {
  return NextResponse.json(
    {
      error: `Forbidden: requires role "${required}"`,
      code: "FORBIDDEN",
    },
    { status: 403 },
  );
}

/**
 * Wrap a Supervisor API route handler with auth + a minimum role gate.
 *
 * @example
 * export const GET = withSupervisorAuth("viewer", async (_req, { user }) => {
 *   return NextResponse.json({ email: user.email });
 * });
 */
export function withSupervisorAuth(
  requiredRole: Role,
  handler: Handler,
): (request: Request, context?: RouteContext) => Promise<NextResponse> {
  return async (request: Request, context?: RouteContext) => {
    try {
      const email = await resolveAuthenticatedEmail(request);
      if (!email) return unauthorized();

      const user = await resolveSupervisorUser(email);

      if (!isRole(user.role) || !hasRole(user, requiredRole)) {
        log.warn("Role gate denied", {
          email,
          role: user.role,
          requiredRole,
        });
        return forbidden(requiredRole);
      }

      const params = context?.params ? await context.params : undefined;
      return await handler(request, { user, params });
    } catch (error) {
      log.error("Unhandled error in supervisor API route", {
        error: String(error),
      });
      return NextResponse.json(
        { error: "Internal server error", code: "INTERNAL_ERROR" },
        { status: 500 },
      );
    }
  };
}

/** Standard "not implemented in Phase 1" response for stubbed endpoints. */
export function phase1Pending(): NextResponse {
  return NextResponse.json(
    { error: "not implemented", code: "PHASE1_PENDING" },
    { status: 501 },
  );
}
