import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";

export interface SchedulerHealth {
  code: 200 | 503;
  body: { status: "ok" | "degraded"; scheduler: boolean };
}

/**
 * Health of the terminal server's scheduler subsystem, shaped for the `/health`
 * endpoint. Returns 503 when the scheduler is not started (failed/crashed/not-
 * yet-up) so `/api/readyz` — which gates on the status code — correctly pulls a
 * wedged terminal server out of the load balancer instead of routing
 * session-create traffic to it (remote-dev-n1uv). 200 only when fully started.
 */
export function getSchedulerHealth(): SchedulerHealth {
  const ready = schedulerOrchestrator.isStarted();
  return ready
    ? { code: 200, body: { status: "ok", scheduler: true } }
    : { code: 503, body: { status: "degraded", scheduler: false } };
}
