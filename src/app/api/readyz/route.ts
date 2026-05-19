/**
 * `GET /api/readyz` — Kubernetes readiness probe.
 *
 * Returns 200 when the pod is ready to serve traffic, 503 when degraded.
 * Checks every dependency required for the request path to function:
 *
 *   - SQLite database connectivity (`SELECT 1`)
 *   - tmux binary callable (sessions are tmux-backed)
 *
 * A failing readiness probe removes the pod from the Service endpoints
 * (no traffic) but does NOT restart the pod — that's liveness' job.
 *
 * Unauthenticated by design: K8s kubelets probe pods without auth. The
 * proxy middleware (`src/proxy.ts`) explicitly bypasses this path.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { execFile } from "@/lib/exec";

// Disable static optimization — probes must run fresh per request.
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, CheckResult> = {};
  let ready = true;

  // DB probe — proves the SQLite file is openable and queryable.
  try {
    await db.run(sql`SELECT 1`);
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, error: String(err) };
    ready = false;
  }

  // tmux probe — proves the binary is installed and callable. Doesn't
  // verify a specific session, just that the dependency is present.
  try {
    await execFile("tmux", ["-V"], { timeout: 2000 });
    checks.tmux = { ok: true };
  } catch (err) {
    checks.tmux = { ok: false, error: String(err) };
    ready = false;
  }

  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
