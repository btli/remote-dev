/**
 * `GET /api/readyz` — Kubernetes readiness probe.
 *
 * Returns 200 when the pod is ready to serve traffic, 503 when degraded.
 * Checks every dependency required for the request path to function:
 *
 *   - SQLite database connectivity (`SELECT 1`)
 *   - tmux binary callable (sessions are tmux-backed)
 *   - Terminal server reachable on loopback (`/health` on TERMINAL_PORT)
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

/**
 * Probe the terminal server on loopback. Without this, the terminal server
 * can be dead (crashed, OOM-killed, mid-restart) while the Next.js process
 * is still healthy — readiness would say "ready" and the LB would route
 * session-create requests that immediately fail. We hit the terminal
 * server's `/health` endpoint (see `src/server/terminal.ts:632`) with a
 * 1s timeout so a wedged terminal server is detected quickly.
 *
 * Uses `127.0.0.1` rather than `localhost` to avoid IPv6/IPv4 resolution
 * surprises in container DNS (some images don't have IPv6 enabled).
 */
async function checkTerminalServer(): Promise<CheckResult> {
  const port = process.env.TERMINAL_PORT ?? "6002";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `terminal server returned HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    clearTimeout(timeout);
  }
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

  // Terminal server probe — proves the sibling process inside this pod is
  // alive and serving HTTP on its WebSocket port. The terminal server runs
  // on the same loopback as Next.js (see `docker/entrypoint.sh`), so a
  // failure here is in-pod and indicates we should not accept LB traffic.
  const terminal = await checkTerminalServer();
  checks.terminal = terminal;
  if (!terminal.ok) {
    ready = false;
  }

  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
