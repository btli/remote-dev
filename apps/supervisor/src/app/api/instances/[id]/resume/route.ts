/**
 * POST /api/instances/:id/resume (operator) — request resume (scale back to 1).
 *
 * Single-writer model (LOCKED): this route ONLY records the desired state on the
 * `instance` row (`suspended → ready` + clear `suspendedAt`) plus an audit row,
 * then returns 202. The reconciler converges the StatefulSet replicas back to 1
 * on its next tick.
 *
 * The slug re-appears in the router allowlist immediately (status === "ready")
 * while the pod takes ~10–30 s to pass its readiness probe → a brief 502/503
 * window through the router. This blip is ACCEPTED (same class as the §9
 * image-rollout blip); router-side Endpoints readiness (§15 M4) is the future
 * mitigation and is out of scope here.
 *
 * Owner-scoped via canManageInstance → 404 (not 403) when not visible.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import { canTransition } from "@/lib/instance-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/resume");

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

  // Already ready → idempotent success (no new write). Checked BEFORE the
  // canTransition gate (a self-transition is not "legal", but it's a no-op 202).
  if (row.status === "ready") {
    return NextResponse.json({ instance: row }, { status: 202 });
  }

  // Gate via the state machine (suspended → ready is the only legal source),
  // mirroring how DELETE uses canTransition(..., "terminating").
  if (!canTransition(row.status, "ready")) {
    return NextResponse.json(
      {
        error: `Cannot resume an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(instance)
    .set({ status: "ready", suspendedAt: null, updatedAt: now })
    .where(eq(instance.id, id))
    .returning();

  await db.insert(instanceAuditLog).values({
    instanceId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "resume",
    previousStatus: row.status,
    newStatus: "ready",
  });

  log.info("instance resume requested", {
    slug: row.slug,
    ownerId: row.ownerId,
    actor: user.email,
  });

  return NextResponse.json({ instance: updated }, { status: 202 });
});
