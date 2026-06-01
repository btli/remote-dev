/**
 * GET /api/instances/:id/events (viewer + owner) — the instance namespace's
 * recent k8s events (newest first).
 *
 * Read-only k8s access from the API process (same in-cluster SA/RBAC). Degrades
 * gracefully: when no cluster is reachable it returns 200 `{ events: [] }` with
 * a note rather than a 500 — never 500 for an unreachable cluster.
 *
 * Owner-scoped via canManageInstance → 404 (not 403) when not visible.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import {
  listInstanceEvents,
  defaultClients,
  type InstanceEventDTO,
} from "@/lib/provisioner-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/events");

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

  // 404 (not 403) when missing OR not visible to the caller.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  // Acquire clients — degrade to empty 200 with a note when no cluster.
  let clients;
  try {
    clients = defaultClients();
  } catch (err) {
    log.debug("k8s unavailable for events; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({ events: [], note: "k8s unavailable" });
  }

  let events: InstanceEventDTO[];
  try {
    events = await listInstanceEvents(row.slug, clients);
  } catch (err) {
    log.warn("listInstanceEvents failed; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({ events: [], note: "could not read events" });
  }

  return NextResponse.json({ events });
});
