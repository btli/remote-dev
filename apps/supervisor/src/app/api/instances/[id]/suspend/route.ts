/**
 * POST /api/instances/:id/suspend (operator) — request suspend (scale to 0).
 *
 * Single-writer model (LOCKED): this route ONLY records the desired state on the
 * `instance` row (`ready → suspended` + `suspendedAt`) plus an audit row, then
 * returns 202. The reconciler is the sole k8s writer — it converges the
 * StatefulSet replicas to 0 (PVC retained) on its next tick. Because
 * `/api/internal/routes` only serves `status === "ready"`, the slug is dropped
 * from the router allowlist automatically — no allowlist code change needed.
 *
 * Owner-scoped via canManageInstance → 404 (not 403) when not visible, matching
 * the existing GET/DELETE so we never leak other owners' instances.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { canTransition } from "@/lib/instance-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/suspend");

export const POST = withSupervisorAuth("operator", async (_request, { user, params }) => {
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

  // 404 (not 403) when missing OR not visible to the caller.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  // Already suspended → idempotent success (no new write). Checked BEFORE the
  // canTransition gate (a self-transition is not "legal", but it's a no-op 202).
  if (row.status === "suspended") {
    return NextResponse.json({ instance: row }, { status: 202 });
  }

  // Gate via the state machine (ready → suspended is the only legal source),
  // mirroring how DELETE uses canTransition(..., "terminating").
  if (!canTransition(row.status, "suspended")) {
    return NextResponse.json(
      {
        error: `Cannot suspend an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(instance)
    .set({ status: "suspended", suspendedAt: now, updatedAt: now })
    .where(eq(instance.id, id))
    .returning();

  await db.insert(instanceAuditLog).values({
    instanceId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "suspend",
    previousStatus: row.status,
    newStatus: "suspended",
  });

  log.info("instance suspend requested", {
    slug: row.slug,
    ownerId: row.ownerId,
    actor: user.email,
  });

  return NextResponse.json({ instance: updated }, { status: 202 });
});
