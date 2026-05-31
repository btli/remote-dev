/**
 * GET /api/internal/routes — the router allowlist endpoint (spec §6.7, §15 B2).
 *
 * Consumed by the Supervisor router (jvcx.6), NOT the UI — there is no user
 * session here. It is gated by a shared secret the router presents:
 *   - SUPERVISOR_INTERNAL_SECRET set → require header
 *     `x-supervisor-internal-secret` to match (else 401).
 *   - unset in production → refuse to serve (503 MISCONFIGURED) — never expose
 *     the allowlist unauthenticated in prod.
 *   - unset in dev → allow, but warn once that it's unauthenticated.
 *
 * Namespace model (§15 B2): ONE namespace per instance (`rdv-<slug>`) with a
 * Service named `rdv` inside it. Each entry is therefore:
 *   slug -> { namespace, service, httpPort, wsPort, ready }
 *
 * Phase 1: no instances reach `ready` yet (provisioning is jvcx.4), so this is
 * effectively empty — but it reads live from the DB so it lights up
 * automatically once provisioning lands.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { instance } from "@/db/schema";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/internal/routes");

/** Convention ports for the instance data plane (matches the instance image). */
const HTTP_PORT = 6001;
const WS_PORT = 6002;
/** Service name inside each `rdv-<slug>` namespace (§15 B2). */
const SERVICE_NAME = "rdv";

let warnedUnauthenticated = false;

export interface RouteEntry {
  namespace: string;
  service: string;
  httpPort: number;
  wsPort: number;
  ready: boolean;
}

/**
 * Authorize an internal-routes request. Returns null when allowed, or a
 * NextResponse to short-circuit. Exported for unit testing.
 */
export function authorizeInternalRequest(request: Request): NextResponse | null {
  const secret = process.env.SUPERVISOR_INTERNAL_SECRET;
  const provided = request.headers.get("x-supervisor-internal-secret");

  if (secret) {
    if (provided !== secret) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    log.error(
      "SUPERVISOR_INTERNAL_SECRET not set; refusing to serve internal routes in production",
      {},
    );
    return NextResponse.json(
      { error: "internal endpoint not configured", code: "MISCONFIGURED" },
      { status: 503 },
    );
  }

  // Dev with no secret: allow, but warn once.
  if (!warnedUnauthenticated) {
    warnedUnauthenticated = true;
    log.warn(
      "SUPERVISOR_INTERNAL_SECRET not set; /api/internal/routes is unauthenticated (dev only)",
    );
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorizeInternalRequest(request);
  if (denied) return denied;

  const ready = await db
    .select()
    .from(instance)
    .where(eq(instance.status, "ready"));

  const routes: Record<string, RouteEntry> = {};
  for (const inst of ready) {
    routes[inst.slug] = {
      namespace: inst.namespace,
      service: SERVICE_NAME,
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      ready: true,
    };
  }

  return NextResponse.json({ routes });
}
