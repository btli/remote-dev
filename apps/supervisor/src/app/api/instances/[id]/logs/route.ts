/**
 * GET /api/instances/:id/logs (viewer + owner) — tail the instance pod log.
 *
 * Read-only k8s access from the API process (the web process has the same
 * in-cluster ServiceAccount/RBAC). Query params:
 *   - ?tail=<n>        — number of trailing lines (default 200, clamped ≤2000).
 *   - ?previous=true   — read the previous (crashed) container instance's log.
 *
 * Degrades gracefully: when no cluster is reachable (local dev,
 * defaultClients()/getKubeConfig() throws) it returns 200 with empty logs and a
 * `note` rather than a 500 — never 500 for an unreachable cluster.
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
  getPodLogs,
  defaultClients,
  type PodLogsResult,
} from "@/lib/provisioner-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/instances/[id]/logs");

const DEFAULT_TAIL = 200;
const MAX_TAIL = 2000;
const CONTAINER = "rdv";

export const GET = withSupervisorAuth("viewer", async (request, { user, params }) => {
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

  const url = new URL(request.url);
  const tailRaw = Number(url.searchParams.get("tail"));
  const tailLines =
    Number.isFinite(tailRaw) && tailRaw > 0
      ? Math.min(Math.floor(tailRaw), MAX_TAIL)
      : DEFAULT_TAIL;
  const previous = url.searchParams.get("previous") === "true";

  // Acquire clients — a missing/invalid kubeconfig (local dev) throws; degrade
  // to an empty 200 with a note rather than 500.
  let clients;
  try {
    clients = defaultClients();
  } catch (err) {
    log.debug("k8s unavailable for logs; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({
      pod: null,
      container: CONTAINER,
      logs: "",
      note: "k8s unavailable",
    });
  }

  let result: PodLogsResult;
  try {
    result = await getPodLogs(row.slug, { tailLines, previous }, clients);
  } catch (err) {
    // A live read failure (transient API error) also degrades to empty + note —
    // the logs surface must never 500.
    log.warn("getPodLogs failed; returning empty", {
      slug: row.slug,
      error: String(err),
    });
    return NextResponse.json({
      pod: null,
      container: CONTAINER,
      logs: "",
      note: "could not read pod logs",
    });
  }

  return NextResponse.json({
    pod: result.pod,
    container: CONTAINER,
    logs: result.logs,
  });
});
