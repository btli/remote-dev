/**
 * `GET /api/healthz` — Kubernetes liveness probe.
 *
 * Returns 200 as long as the Node process is alive and responsive to HTTP.
 * Liveness probes intentionally do not check DB / tmux / external state —
 * those are readiness signals. A failing liveness probe restarts the pod;
 * we only want that when the JS event loop itself is wedged.
 *
 * Unauthenticated by design: K8s kubelets probe pods without auth. The
 * proxy middleware (`src/proxy.ts`) explicitly bypasses this path.
 */

import { NextResponse } from "next/server";

// Disable static optimization — probes need a live response per request.
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
