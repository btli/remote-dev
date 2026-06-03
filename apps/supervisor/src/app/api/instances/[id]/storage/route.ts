/**
 * GET /api/instances/:id/storage?path=<p> (operator + owner) — list a directory
 * under the instance's persistent data volume (PVC `data-rdv-0`), READ-ONLY, via
 * an ephemeral inspector Job (src/lib/inspector-service.ts). Works even when the
 * instance is STOPPED (subject to the node-pinned-volume caveat).
 *
 * Single-writer note: the inspector Job is ephemeral, namespaced, read-only, and
 * self-deleting — it NEVER touches instance lifecycle state — so dispatching it
 * from the API process is acceptable (analogous to the logs route's read). See
 * the inspector-service header.
 *
 * Degrades gracefully like the logs route: when no cluster is reachable, returns
 * 200 with an EMPTY listing + a `note` (never 500). A few-second latency per call
 * (Job round-trip) is expected. Owner-scoped → 404 (not 403) when not visible.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { withSupervisorAuth } from "@/lib/auth";
import { canManageInstance } from "@/lib/roles";
import {
  listVolume,
  defaultClients,
  InspectorPathError,
  InspectorPendingError,
  InspectorTimeoutError,
  type VolumeListing,
} from "@/lib/inspector-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/storage");

export const GET = withSupervisorAuth("operator", async (request, { user, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing instance id", code: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const row = await db.query.instance.findFirst({ where: eq(instance.id, id) });

  // 404 (not 403) when missing OR not visible to the caller.
  if (!row || !canManageInstance(user, row)) {
    return NextResponse.json(
      { error: "Instance not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const path = new URL(request.url).searchParams.get("path") ?? "/";

  // Acquire clients — a missing/invalid kubeconfig (local dev) throws; degrade
  // to an EMPTY listing + note rather than 500 (mirrors the logs route).
  let clients;
  try {
    clients = defaultClients();
  } catch (err) {
    log.debug("k8s unavailable for storage; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({
      listing: { path: "", entries: [], truncated: false },
      note: "k8s unavailable",
    });
  }

  let listing: VolumeListing;
  try {
    listing = await listVolume(row.slug, path, clients);
  } catch (err) {
    // A bad path is a client error (400). Pending/timeout (node-pinned + stopped)
    // is a 200 with a clear note so the UI can prompt the operator to Start it.
    // Any other inspector failure also degrades to a noted empty listing.
    if (err instanceof InspectorPathError) {
      return NextResponse.json(
        { error: String(err.message), code: "INVALID_PATH" },
        { status: 400 },
      );
    }
    if (err instanceof InspectorPendingError || err instanceof InspectorTimeoutError) {
      log.info("storage inspector could not mount volume", {
        slug: row.slug,
        error: String(err.message),
      });
      return NextResponse.json({
        listing: { path: "", entries: [], truncated: false },
        note: String(err.message),
      });
    }
    log.warn("listVolume failed; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({
      listing: { path: "", entries: [], truncated: false },
      note: "could not read storage",
    });
  }

  return NextResponse.json({ listing });
});
