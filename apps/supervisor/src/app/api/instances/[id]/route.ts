/**
 * /api/instances/:id
 *   GET    (viewer)   — detail from DB, owner-checked.
 *   PATCH  (operator) — update desired spec (displayName / imageTag /
 *                       storageRequest). Records desired state + an audit row
 *                       and returns 202; the reconciler actuates image rollout
 *                       and grow-only PVC resize on its next tick.
 *   DELETE (admin)    — terminate; admin OR owner via canManageInstance. Marks
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
import { parseQuantityToBytes } from "@/lib/provisioner-service";
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

interface PatchInstanceBody {
  displayName?: unknown;
  imageTag?: unknown;
  storageRequest?: unknown;
}

/**
 * PATCH /api/instances/:id — update an instance's desired spec (operator + owner).
 *
 * Body (at least one field required):
 *   - displayName    — non-empty string. Renamed in the DB only (audit `rename`).
 *   - imageTag       — non-empty string. Sets the DESIRED image; the reconciler
 *                      rolls the StatefulSet to it on its next tick (audit
 *                      `image:request`). A rolling update causes a brief blip
 *                      while the new pod becomes ready (§9, accepted).
 *   - storageRequest — a k8s quantity STRICTLY greater than the current
 *                      `storageRequest` (grow-only; k8s forbids PVC shrink).
 *                      Sets the desired size; the reconciler resizes the bound
 *                      PVC (audit `resize:request`). 400 if not greater /
 *                      unparseable.
 *
 * Single-writer model: this route only records desired state + audit rows and
 * returns 202; the reconciler is the sole k8s writer. Only legal while the
 * instance is `ready` or `suspended` (else 409). Owner-scoped via
 * canManageInstance → 404 (not 403) when not visible.
 */
export const PATCH = withSupervisorAuth("operator", async (request, { user, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing instance id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  let body: PatchInstanceBody;
  try {
    body = (await request.json()) as PatchInstanceBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "INVALID_JSON" },
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

  // Edits are only meaningful for a live instance (it has a StatefulSet/PVC).
  if (row.status !== "ready" && row.status !== "suspended") {
    return NextResponse.json(
      {
        error: `Cannot edit an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
      { status: 409 },
    );
  }

  // Validate each provided field. Collect the row update + audit actions.
  const updates: Record<string, unknown> = {};
  const audits: { action: string; metadata?: Record<string, unknown> }[] = [];

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.trim() === "") {
      return NextResponse.json(
        { error: "displayName must be a non-empty string", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
    const displayName = body.displayName.trim();
    updates.displayName = displayName;
    audits.push({ action: "rename", metadata: { from: row.displayName, to: displayName } });
  }

  if (body.imageTag !== undefined) {
    if (typeof body.imageTag !== "string" || body.imageTag.trim() === "") {
      return NextResponse.json(
        { error: "imageTag must be a non-empty string", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
    const imageTag = body.imageTag.trim();
    updates.imageTag = imageTag;
    audits.push({ action: "image:request", metadata: { from: row.imageTag, to: imageTag } });
  }

  if (body.storageRequest !== undefined) {
    if (typeof body.storageRequest !== "string" || body.storageRequest.trim() === "") {
      return NextResponse.json(
        { error: "storageRequest must be a non-empty string", code: "INVALID_BODY" },
        { status: 400 },
      );
    }
    const storageRequest = body.storageRequest.trim();
    const desiredBytes = parseQuantityToBytes(storageRequest);
    if (desiredBytes === null) {
      return NextResponse.json(
        {
          error: `storageRequest "${storageRequest}" is not a valid size (use Ki/Mi/Gi/Ti)`,
          code: "INVALID_BODY",
        },
        { status: 400 },
      );
    }
    // Grow-only: the new request must be STRICTLY larger than the current
    // REQUESTED/desired size (`row.storageRequest`). We deliberately do NOT read
    // the live PVC here (this route stays cluster-independent), so the baseline
    // is the last requested value — if a prior expansion was rejected by the
    // cluster, the requested size may exceed the actual PVC capacity; resubmit a
    // value larger than the requested size to retry.
    const currentBytes = parseQuantityToBytes(row.storageRequest);
    if (currentBytes !== null && desiredBytes <= currentBytes) {
      return NextResponse.json(
        {
          error: `storageRequest must be larger than the current requested size (${row.storageRequest}); PVCs cannot shrink`,
          code: "INVALID_RESIZE",
        },
        { status: 400 },
      );
    }
    updates.storageRequest = storageRequest;
    audits.push({
      action: "resize:request",
      metadata: { from: row.storageRequest, to: storageRequest },
    });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        error: "At least one of displayName, imageTag, storageRequest is required",
        code: "INVALID_BODY",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(instance)
    .set({ ...updates, updatedAt: now })
    .where(eq(instance.id, id))
    .returning();

  for (const audit of audits) {
    await db.insert(instanceAuditLog).values({
      instanceId: id,
      actorId: user.id,
      actorEmail: user.email,
      action: audit.action,
      previousStatus: row.status,
      newStatus: row.status,
      metadata: audit.metadata ? JSON.stringify(audit.metadata) : null,
    });
  }

  log.info("instance patch requested", {
    slug: row.slug,
    actor: user.email,
    fields: Object.keys(updates),
  });

  return NextResponse.json({ instance: updated }, { status: 202 });
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
