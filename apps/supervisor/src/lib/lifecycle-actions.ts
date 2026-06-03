/**
 * Shared suspend/resume (a.k.a. Stop/Start) request handlers.
 *
 * Suspend/resume are surfaced in the UI as **Stop** / **Start** (a terminology
 * change, remote-dev-jvcx.15) but the canonical statuses (`ready`/`suspended`)
 * and audit actions (`"suspend"`/`"resume"`) are UNCHANGED — this is purely
 * ergonomic. The `/suspend` + `/resume` routes and their `/stop` + `/start`
 * aliases all funnel through {@link requestSuspend} / {@link requestResume} so
 * the behavior is identical and tested once.
 *
 * Single-writer model (LOCKED): these helpers ONLY record the desired state on
 * the `instance` row plus an audit row — they NEVER touch the cluster. The
 * reconciler is the sole k8s writer; it converges the StatefulSet replicas
 * (0 when suspended, 1 when ready, PVC retained) on its next tick. Because
 * `/api/internal/routes` only serves `status === "ready"`, suspending drops the
 * slug from the router allowlist automatically.
 *
 * Each helper returns a plain {@link LifecycleResult} that the route maps to a
 * NextResponse, so the helpers stay framework-light and unit-testable.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance, instanceAuditLog } from "@/db/schema";
import type { SupervisorUserRow } from "@/db/schema";
import { canManageInstance, type Role } from "@/lib/roles";
import { canTransition } from "@/lib/instance-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("lifecycle-actions");

/**
 * The acting user shape the lifecycle helpers need (from withSupervisorAuth's
 * `SupervisorUserRow`). `role` is the typed {@link Role} so owner-scoping via
 * `canManageInstance` type-checks.
 */
type ActingUser = Pick<SupervisorUserRow, "id" | "email"> & { role: Role };

/** A framework-light result the route maps to a NextResponse. */
export interface LifecycleResult {
  status: number;
  /** The JSON body to return. */
  body: Record<string, unknown>;
}

/** 404 (not 403) when missing OR not visible — never leak other owners. */
function notFound(): LifecycleResult {
  return {
    status: 404,
    body: { error: "Instance not found", code: "NOT_FOUND" },
  };
}

function missingId(): LifecycleResult {
  return {
    status: 400,
    body: { error: "Missing instance id", code: "INVALID_BODY" },
  };
}

/**
 * Request a SUSPEND (Stop): `ready → suspended` (+ suspendedAt) + audit row,
 * 202. Idempotent on an already-suspended instance (202, no write). Owner-scoped
 * → 404. Illegal source status → 409 INVALID_STATE.
 */
export async function requestSuspend(
  user: ActingUser,
  id: string | undefined,
): Promise<LifecycleResult> {
  if (!id) return missingId();

  const row = await db.query.instance.findFirst({ where: eq(instance.id, id) });
  if (!row || !canManageInstance(user, row)) return notFound();

  // Already suspended → idempotent success (no new write). Checked BEFORE the
  // canTransition gate (a self-transition is not "legal", but it's a no-op 202).
  if (row.status === "suspended") {
    return { status: 202, body: { instance: row } };
  }

  // Gate via the state machine (ready → suspended is the only legal source).
  if (!canTransition(row.status, "suspended")) {
    return {
      status: 409,
      body: {
        error: `Cannot stop an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
    };
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

  log.info("instance stop (suspend) requested", {
    slug: row.slug,
    ownerId: row.ownerId,
    actor: user.email,
  });

  return { status: 202, body: { instance: updated } };
}

/**
 * Request a RESUME (Start): `suspended → ready` (+ clear suspendedAt) + audit
 * row, 202. Idempotent on an already-ready instance (202, no write). Owner-scoped
 * → 404. Illegal source status → 409 INVALID_STATE.
 */
export async function requestResume(
  user: ActingUser,
  id: string | undefined,
): Promise<LifecycleResult> {
  if (!id) return missingId();

  const row = await db.query.instance.findFirst({ where: eq(instance.id, id) });
  if (!row || !canManageInstance(user, row)) return notFound();

  // Already ready → idempotent success (no new write).
  if (row.status === "ready") {
    return { status: 202, body: { instance: row } };
  }

  // Gate via the state machine (suspended → ready is the only legal source).
  if (!canTransition(row.status, "ready")) {
    return {
      status: 409,
      body: {
        error: `Cannot start an instance in status "${row.status}"`,
        code: "INVALID_STATE",
      },
    };
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

  log.info("instance start (resume) requested", {
    slug: row.slug,
    ownerId: row.ownerId,
    actor: user.email,
  });

  return { status: 202, body: { instance: updated } };
}
