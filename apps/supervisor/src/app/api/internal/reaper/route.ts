/**
 * POST /api/internal/reaper (epic remote-dev-oyej.9)
 *
 * Gated by `SUPERVISOR_REAPER_SECRET` (mirrors the `/api/internal/routes`
 * shared-secret gate — refuse unauthenticated in production). Runs the
 * idle-suspend sweep + warm-pool GC ONCE and returns counts. Called on a
 * schedule by the reaper CronJob (deploy/k8s/supervisor/reaper-cronjob.yaml),
 * so the suspend/GC sweep runs even if the 30s reconciler is conservative.
 *
 * Single-writer model preserved: idle suspend only REQUESTS `suspended` on the
 * instance row (the reconciler is the sole k8s writer); warm-pool GC requests
 * `terminating` + deletes the pool row.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { instance, warmPool } from "@/db/schema";
import { requestSuspend } from "@/lib/lifecycle-actions";
import { isInstanceIdle, type IdleDeps } from "@/lib/idle-detector";
import { gcExpired } from "@/lib/warm-pool";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/internal/reaper");

export const dynamic = "force-dynamic";

let warnedUnauthenticated = false;

/**
 * Constant-time secret comparison. Length is checked first (the lengths are not
 * themselves secret) so timingSafeEqual never throws on a length mismatch, then
 * the bytes are compared in constant time — mirroring the deploy/GitHub webhook
 * verifier so the gate doesn't leak the secret via response timing.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Authorize a reaper request. Returns null when allowed, else a NextResponse. */
export function authorizeReaper(request: Request): NextResponse | null {
  const secret = process.env.SUPERVISOR_REAPER_SECRET;
  const provided = request.headers.get("x-supervisor-internal-secret");
  if (secret) {
    if (!secretMatches(provided, secret)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    return null;
  }
  if (process.env.NODE_ENV === "production") {
    log.error("SUPERVISOR_REAPER_SECRET not set; refusing reaper in production");
    return NextResponse.json(
      { error: "reaper not configured", code: "MISCONFIGURED" },
      { status: 503 },
    );
  }
  if (!warnedUnauthenticated) {
    warnedUnauthenticated = true;
    log.warn(
      "SUPERVISOR_REAPER_SECRET not set; /api/internal/reaper is unauthenticated (dev only)",
    );
  }
  return null;
}

/** A reaper-scoped acting user for the lifecycle audit trail. */
const REAPER_ACTOR = {
  id: "reaper",
  email: "reaper@supervisor.internal",
  role: "admin" as const,
};

/**
 * Run the idle-suspend sweep + warm-pool GC once. `idleDeps` is injectable so
 * tests can stub the data-plane probe.
 */
export async function runReaper(idleDeps?: IdleDeps): Promise<{
  suspended: number;
  warmPoolGc: number;
}> {
  const idleTimeoutMs = Number(
    process.env.SUPERVISOR_AGENT_IDLE_TIMEOUT_MS ?? `${30 * 60 * 1000}`,
  );

  // Scale-to-zero candidates: ready instances paired with a CLAIMED warm-pool
  // row (i.e. an agent-run env). Suspending them retains the PVC.
  const claimed = await db
    .select({ instanceId: warmPool.instanceId })
    .from(warmPool)
    .where(eq(warmPool.status, "claimed"));
  const claimedIds = new Set(claimed.map((c) => c.instanceId));

  let suspended = 0;
  if (claimedIds.size > 0) {
    const readyClaimed = await db
      .select()
      .from(instance)
      .where(
        and(
          eq(instance.status, "ready"),
          inArray(instance.id, [...claimedIds]),
        ),
      );
    for (const row of readyClaimed) {
      try {
        if (await isInstanceIdle(row, idleTimeoutMs, idleDeps)) {
          const res = await requestSuspend(REAPER_ACTOR, row.id);
          if (res.status === 202) suspended += 1;
        }
      } catch (err) {
        log.warn("reaper failed to evaluate/suspend instance", {
          slug: row.slug,
          error: String(err),
        });
      }
    }
  }

  const warmPoolGc = await gcExpired();
  log.info("reaper sweep complete", { suspended, warmPoolGc });
  return { suspended, warmPoolGc };
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = authorizeReaper(request);
  if (denied) return denied;
  const result = await runReaper();
  return NextResponse.json(result);
}
