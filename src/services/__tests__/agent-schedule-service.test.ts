// @vitest-environment node
/**
 * Unit tests for AgentScheduleService — the pure validation + nextRun logic
 * (epic remote-dev-oyej.1). DB CRUD against libsql is covered by integration
 * tests; here we exercise the cron/provider validation that gates creates.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ agentSchedules: {}, agentRuns: {} }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import {
  validateAgentScheduleInput,
  AgentScheduleServiceError,
} from "../agent-schedule-service";

describe("validateAgentScheduleInput", () => {
  it("accepts a valid recurring schedule and computes nextRunAt", () => {
    const r = validateAgentScheduleInput({
      projectId: "p1",
      name: "nightly",
      prompt: "run the suite",
      scheduleType: "recurring",
      cronExpression: "0 3 * * *",
      timezone: "America/Los_Angeles",
      agentProvider: "claude",
    });
    expect(r.scheduleType).toBe("recurring");
    expect(r.nextRunAt).toBeInstanceOf(Date);
    expect(r.agentProvider).toBe("claude");
  });

  it("rejects a bad cron expression", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: "p1",
        name: "x",
        prompt: "p",
        scheduleType: "recurring",
        cronExpression: "not a cron",
      }),
    ).toThrow(AgentScheduleServiceError);
  });

  it("requires a cronExpression for recurring schedules", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: "p1",
        name: "x",
        prompt: "p",
        scheduleType: "recurring",
      }),
    ).toThrow(/cron/i);
  });

  it("requires a future scheduledAt for one-time schedules", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: "p1",
        name: "x",
        prompt: "p",
        scheduleType: "one-time",
        scheduledAt: new Date(Date.now() - 1000),
      }),
    ).toThrow(/future|past/i);
  });

  it("computes nextRunAt = scheduledAt for a valid one-time schedule", () => {
    const at = new Date(Date.now() + 3_600_000);
    const r = validateAgentScheduleInput({
      projectId: "p1",
      name: "x",
      prompt: "p",
      scheduleType: "one-time",
      scheduledAt: at,
    });
    expect(r.nextRunAt?.getTime()).toBe(at.getTime());
  });

  it("rejects an unknown agent provider", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: "p1",
        name: "x",
        prompt: "p",
        scheduleType: "recurring",
        cronExpression: "0 3 * * *",
        agentProvider: "bogus-agent",
      }),
    ).toThrow(/provider/i);
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: "p1",
        name: "x",
        prompt: "   ",
        scheduleType: "recurring",
        cronExpression: "0 3 * * *",
      }),
    ).toThrow(/prompt/i);
  });

  it("defaults provider to claude and timezone to LA when omitted", () => {
    const r = validateAgentScheduleInput({
      projectId: "p1",
      name: "x",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 3 * * *",
    });
    expect(r.agentProvider).toBe("claude");
    expect(r.timezone).toBe("America/Los_Angeles");
  });
});
