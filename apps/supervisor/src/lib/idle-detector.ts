/**
 * Idle detector for scale-to-zero (epic remote-dev-oyej.9 — extends jvcx).
 *
 * Decides whether a `ready` agent-run instance is idle (no active terminal
 * sessions + last-activity older than the timeout) so the reconciler can request
 * `suspended` (jvcx's reconcileSteadyState then scales the StatefulSet to 0, PVC
 * retained). FAIL-SAFE: an unreachable instance is treated as NOT idle — we
 * never suspend on a failed probe.
 */
import { instanceFetch, type ProxyInstance } from "@/lib/instance-proxy";
import { createLogger } from "@/lib/logger";

const log = createLogger("idle-detector");

export interface IdleProbeResult {
  /** Number of active terminal sessions on the instance. */
  activeSessions: number;
  reachable: boolean;
}

/** Injectable seam so the reconciler/tests can stub the data-plane probe. */
export interface IdleDeps {
  probe(row: ProxyInstance): Promise<IdleProbeResult>;
  now(): number;
}

/** Default probe: GET the instance's active-session count via the proxy. */
async function defaultProbe(row: ProxyInstance): Promise<IdleProbeResult> {
  try {
    const res = await instanceFetch(row, "/api/sessions?status=active", {
      method: "GET",
    });
    if (!res.ok) return { activeSessions: 0, reachable: false };
    const data = (await res.json()) as { sessions?: unknown[] };
    const count = Array.isArray(data.sessions) ? data.sessions.length : 0;
    return { activeSessions: count, reachable: true };
  } catch (err) {
    log.debug("idle probe failed (treating as not-idle)", {
      slug: row.slug,
      error: String(err),
    });
    return { activeSessions: 0, reachable: false };
  }
}

export function defaultIdleDeps(): IdleDeps {
  return { probe: defaultProbe, now: () => Date.now() };
}

/**
 * Determine whether an instance is idle. An instance is idle when:
 *   - the data-plane probe is REACHABLE (fail-safe: unreachable ⇒ not idle), AND
 *   - it has zero active terminal sessions, AND
 *   - its last activity (provisionedAt / suspendedAt / updatedAt fallback) is
 *     older than `idleTimeoutMs`.
 */
export async function isInstanceIdle(
  row: {
    slug: string;
    baseUrl?: string | null;
    provisionedAt?: Date | null;
    updatedAt?: Date | null;
  },
  idleTimeoutMs: number,
  deps: IdleDeps = defaultIdleDeps(),
): Promise<boolean> {
  const probe = await deps.probe(row);
  if (!probe.reachable) return false; // fail-safe
  if (probe.activeSessions > 0) return false;

  const lastActivity = (row.provisionedAt ?? row.updatedAt)?.getTime() ?? 0;
  const ageMs = deps.now() - lastActivity;
  return ageMs >= idleTimeoutMs;
}
