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
import http from "node:http";
import { runProbe } from "@/db";
import { execFile } from "@/lib/exec";

// Disable static optimization — probes must run fresh per request.
export const dynamic = "force-dynamic";

const TERMINAL_CHECK_TIMEOUT_MS = 1000;

interface CheckResult {
  ok: boolean;
  error?: string;
}

/**
 * GET `/health` over a Unix socket. Production runs the terminal server on a
 * Unix socket (`TERMINAL_SOCKET`), not a TCP port — `fetch()` can't address a
 * Unix socket cleanly, so we use `node:http` with `socketPath` (same approach
 * as `src/lib/scheduler-client.ts`). A non-2xx response or any transport
 * error resolves to `{ ok: false }`; a 1s timeout guards a wedged server.
 */
function healthOverSocket(socketPath: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: CheckResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.request({ socketPath, path: "/health", method: "GET" }, (res) => {
      // Drain so the socket can close cleanly.
      res.on("data", () => {});
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          settle({ ok: true });
        } else {
          settle({ ok: false, error: `terminal server returned HTTP ${status}` });
        }
      });
    });
    req.setTimeout(TERMINAL_CHECK_TIMEOUT_MS, () => {
      req.destroy();
      settle({ ok: false, error: "terminal server health check timed out" });
    });
    req.on("error", (err) => {
      req.destroy();
      settle({ ok: false, error: String(err) });
    });
    req.end();
  });
}

/**
 * GET `/health` over a TCP loopback port (development mode). Uses `127.0.0.1`
 * rather than `localhost` to avoid IPv6/IPv4 resolution surprises in container
 * DNS (some images don't have IPv6 enabled).
 */
async function healthOverPort(port: string): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TERMINAL_CHECK_TIMEOUT_MS);
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

/**
 * Probe the terminal server. Without this, the terminal server can be dead
 * (crashed, OOM-killed, mid-restart) while the Next.js process is still
 * healthy — readiness would say "ready" and the LB would route session-create
 * requests that immediately fail. We hit the terminal server's `/health`
 * endpoint (see `src/server/terminal.ts`) with a 1s timeout so a wedged
 * terminal server is detected quickly. That `/health` now returns 503 (not just
 * 200-when-the-listener-is-up) when its scheduler subsystem is down, so this
 * status-code gate reflects scheduler health too — not merely "the process is
 * listening" (remote-dev-n1uv).
 *
 * Transport selection mirrors the rest of the codebase (scheduler-client.ts,
 * terminal-server-url.ts): prod runs on a Unix socket (`TERMINAL_SOCKET`), dev
 * on a TCP port (`TERMINAL_PORT`). Previously this always used the TCP port,
 * so prod readiness falsely reported 503 even when the terminal server was up.
 */
async function checkTerminalServer(): Promise<CheckResult> {
  const socketPath = process.env.TERMINAL_SOCKET;
  if (socketPath) {
    return healthOverSocket(socketPath);
  }
  const port = process.env.TERMINAL_PORT ?? "6002";
  return healthOverPort(port);
}

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, CheckResult> = {};
  let ready = true;

  // DB probe — proves the database is openable and queryable (dialect-neutral).
  try {
    await runProbe();
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
