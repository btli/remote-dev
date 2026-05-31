// @vitest-environment node
/**
 * Tests for getSchedulerHealth — the pure helper behind the terminal server's
 * `/health` endpoint (remote-dev-n1uv).
 *
 * The mapping is the whole point: when the scheduler subsystem is started the
 * helper returns 200 (status "ok"); when it is NOT started (failed to come up,
 * crashed, or stopped) it returns 503 (status "degraded"). `/api/readyz` gates
 * on the status code, so the 503 is what pulls a wedged terminal server out of
 * the load balancer.
 *
 * `scheduler-orchestrator.js` is mocked to a bare singleton with an
 * `isStarted` mock — we never touch the real orchestrator (which would spin up
 * jobs/timers on import). The relative path from this file
 * (`src/server/__tests__/`) up to `src/services/scheduler-orchestrator.js` is
 * `../../services/scheduler-orchestrator.js`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/scheduler-orchestrator.js", () => ({
  schedulerOrchestrator: { isStarted: vi.fn() },
}));

import { schedulerOrchestrator } from "../../services/scheduler-orchestrator.js";
import { getSchedulerHealth } from "../scheduler-health.js";

const isStartedMock = vi.mocked(schedulerOrchestrator.isStarted);

beforeEach(() => {
  isStartedMock.mockReset();
});

describe("getSchedulerHealth", () => {
  it("returns 200 / ok when the scheduler is started", () => {
    isStartedMock.mockReturnValue(true);

    expect(getSchedulerHealth()).toEqual({
      code: 200,
      body: { status: "ok", scheduler: true },
    });
  });

  it("returns 503 / degraded when the scheduler is not started", () => {
    isStartedMock.mockReturnValue(false);

    expect(getSchedulerHealth()).toEqual({
      code: 503,
      body: { status: "degraded", scheduler: false },
    });
  });
});
