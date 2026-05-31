/**
 * /api/instances/:id
 *   GET    (viewer)   — detail from DB, owner-checked.
 *   DELETE (operator) — terminate; admin OR owner via canManageInstance. Marks
 *                       the row `terminating` and returns 202; the reconciler
 *                       (jvcx.4) deletes the namespace and confirms it's gone.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { canTransition } from "@/lib/instance-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]");

/** GET /api/instances/:id — owner-checked detail. */
export const GET = withSupervisorAuth("viewer", async (_request, { user, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing instance id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const row = await db.query.instance.findFirst({
    where: eq(instance.id, id),
  });

  // 404 both when missing AND when the caller may not see it — don't leak
  // existence of other owners' instances to non-admins.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json({ instance: row });
});

/**
 * DELETE /api/instances/:id — terminate the instance.
 *
 * Admin-only per the role matrix (§6.6/§6.7): delete is an admin privilege.
 * Owner-scoping (canManageInstance) governs visibility/management of
 * create/suspend/resume, not delete — but we keep the canManageInstance/404
 * check here too (harmless for admins, who manage all). Transitions the row to
 * `terminating` and returns 202; the reconciler deletes the namespace (cascade)
 * and marks the row `deleted` once it confirms the namespace is gone.
 */
export const DELETE = withSupervisorAuth("admin", async (_request, { user, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing instance id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const row = await db.query.instance.findFirst({
    where: eq(instance.id, id),
  });

  // 404 (not 403) when missing OR not visible to the caller — don't leak
  // existence of other owners' instances.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  // Already terminating/deleted → idempotent success.
  if (row.status === "terminating" || row.status === "deleted") {
    return NextResponse.json({ instance: row }, { status: 202 });
  }

  if (!canTransition(row.status, "terminating")) {
    return NextResponse.json(
      {
        error: `Cannot terminate an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(instance)
    .set({ status: "terminating", updatedAt: now })
    .where(eq(instance.id, id))
    .returning();

  await db.insert(instanceAuditLog).values({
    instanceId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "delete",
    previousStatus: row.status,
    newStatus: "terminating",
  });

  log.info("instance termination requested", {
    slug: row.slug,
    ownerId: row.ownerId,
    actor: user.email,
  });

  return NextResponse.json({ instance: updated }, { status: 202 });
});
