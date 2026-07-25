// @vitest-environment node
/**
 * AgentScheduleService validation and persistence tests.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  type TestDbHandle,
} from "./migration-test-db";

let handle: TestDbHandle;

vi.mock("@/db", () => ({
  get db() {
    return handle.db;
  },
}));
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
  calculateNextIntervalRun,
  createAgentSchedule,
  markScheduleFired,
  persistNextRunAt,
  updateAgentSchedule,
  validateAgentScheduleInput,
  AgentScheduleServiceError,
} from "../agent-schedule-service";
import { agentSchedules, projects, users } from "@/db/schema";

const USER = "agent-schedule-user";
const PROJECT = "agent-schedule-project";

async function getScheduleRow(id: string) {
  const row = await handle.db.query.agentSchedules.findFirst({
    where: eq(agentSchedules.id, id),
  });
  expect(row).toBeDefined();
  return row!;
}

beforeEach(async () => {
  handle = await createTestDb("rdv-agent-schedule-service-test-");
  await handle.db.insert(users).values({
    id: USER,
    email: "agent-schedule@example.com",
  });
  await handle.db.insert(projects).values({
    id: PROJECT,
    userId: USER,
    name: "Agent Schedule Project",
  });
});

afterEach(() => {
  handle.cleanup();
});

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
    // No explicit profile → null (auto-select at launch).
    expect(r.profileId).toBeNull();
  });

  it("normalizes an explicit profileId (pin) and defaults it to null when absent", () => {
    const pinned = validateAgentScheduleInput({
      projectId: "p1",
      name: "nightly",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 3 * * *",
      profileId: "profile-pin",
    });
    expect(pinned.profileId).toBe("profile-pin");

    const auto = validateAgentScheduleInput({
      projectId: "p1",
      name: "nightly",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 3 * * *",
      profileId: null,
    });
    expect(auto.profileId).toBeNull();
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

  it("rejects unknown schedule types explicitly", () => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: PROJECT,
        name: "x",
        prompt: "p",
        scheduleType: "unknown" as never,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SCHEDULE_TYPE" }));
  });
});

describe("interval agent schedules", () => {
  it("creates an anchor-aligned interval schedule and skips missed ticks", async () => {
    const anchorAt = new Date(Date.now() - 3 * 3_600_000);
    const created = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Every five hours",
      prompt: "run the suite",
      scheduleType: "interval",
      intervalSeconds: 5 * 3_600,
      anchorAt: anchorAt.toISOString(),
      timezone: "UTC",
    });

    expect(created.scheduleType).toBe("interval");
    expect(created.intervalSeconds).toBe(18_000);
    expect(created.anchorAt?.getTime()).toBe(anchorAt.getTime());
    expect(created.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(created.nextRunAt!.getTime()).toBe(
      calculateNextIntervalRun(anchorAt, 18_000).getTime(),
    );
  });

  it.each([59, 2_592_001])(
    "rejects invalid intervalSeconds %s",
    (intervalSeconds) => {
      expect(() =>
        validateAgentScheduleInput({
          projectId: PROJECT,
          name: "Invalid interval",
          prompt: "p",
          scheduleType: "interval",
          intervalSeconds,
          anchorAt: new Date(),
          timezone: "UTC",
        }),
      ).toThrow(
        expect.objectContaining({ code: "INVALID_INTERVAL_SECONDS" }),
      );
    },
  );

  it("rejects a missing or invalid interval anchor", () => {
    const base = {
      projectId: PROJECT,
      name: "Invalid anchor",
      prompt: "p",
      scheduleType: "interval" as const,
      intervalSeconds: 300,
      timezone: "UTC",
    };
    expect(() => validateAgentScheduleInput(base)).toThrow(
      expect.objectContaining({ code: "ANCHOR_AT_REQUIRED" }),
    );
    expect(() =>
      validateAgentScheduleInput({ ...base, anchorAt: "not-a-date" }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ANCHOR_AT" }));
  });

  it.each([
    {
      scheduleType: "one-time" as const,
      scheduledAt: new Date(Date.now() + 3_600_000),
    },
    {
      scheduleType: "recurring" as const,
      cronExpression: "0 * * * *",
    },
    {
      scheduleType: "interval" as const,
      intervalSeconds: 300,
      anchorAt: new Date(),
    },
  ])("rejects invalid timezone for $scheduleType schedules", (timing) => {
    expect(() =>
      validateAgentScheduleInput({
        projectId: PROJECT,
        name: "Invalid timezone",
        prompt: "p",
        timezone: "Mars/Olympus_Mons",
        ...timing,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_TIMEZONE" }));
  });

  it.each([
    {
      scheduleType: "one-time" as const,
      scheduledAt: new Date(Date.now() + 3_600_000),
    },
    {
      scheduleType: "recurring" as const,
      cronExpression: "0 * * * *",
    },
    {
      scheduleType: "interval" as const,
      intervalSeconds: 300,
      anchorAt: new Date(),
    },
  ])(
    "rejects an invalid timezone update for $scheduleType schedules",
    async (timing) => {
      const created = await createAgentSchedule(USER, {
        projectId: PROJECT,
        name: `Timezone update ${timing.scheduleType}`,
        prompt: "p",
        timezone: "UTC",
        ...timing,
      });

      await expect(
        updateAgentSchedule(USER, created.id, {
          timezone: "Mars/Olympus_Mons",
        }),
      ).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
    },
  );

  it("clears fields from prior types when switching schedule type", async () => {
    const recurring = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Switching",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
      timezone: "UTC",
    });
    await handle.db
      .update(agentSchedules)
      .set({ enabled: false, status: "completed" })
      .where(eq(agentSchedules.id, recurring.id));

    const anchorAt = new Date(Date.now() - 3_600_000);
    const interval = await updateAgentSchedule(USER, recurring.id, {
      scheduleType: "interval",
      intervalSeconds: 900,
      anchorAt: anchorAt.toISOString(),
    });
    expect(interval).toMatchObject({
      scheduleType: "interval",
      cronExpression: null,
      scheduledAt: null,
      intervalSeconds: 900,
      enabled: true,
      status: "active",
    });
    expect(interval!.anchorAt?.getTime()).toBe(anchorAt.getTime());

    const scheduledAt = new Date(Date.now() + 3_600_000);
    const oneTime = await updateAgentSchedule(USER, recurring.id, {
      scheduleType: "one-time",
      scheduledAt,
    });
    expect(oneTime).toMatchObject({
      scheduleType: "one-time",
      cronExpression: null,
      intervalSeconds: null,
      anchorAt: null,
    });
    expect(oneTime!.scheduledAt?.getTime()).toBe(scheduledAt.getTime());

    const switchedBack = await updateAgentSchedule(USER, recurring.id, {
      scheduleType: "recurring",
      cronExpression: "*/15 * * * *",
    });
    expect(switchedBack).toMatchObject({
      scheduleType: "recurring",
      cronExpression: "*/15 * * * *",
      scheduledAt: null,
      intervalSeconds: null,
      anchorAt: null,
    });
  });

  it("switches recurring to one-time and clears recurring fields", async () => {
    const recurring = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Recurring to one-time",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
      timezone: "UTC",
    });
    const previousNextRunAt = recurring.nextRunAt!.getTime();
    const scheduledAt = new Date(Date.now() + 3_600_000);

    const updated = await updateAgentSchedule(USER, recurring.id, {
      scheduleType: "one-time",
      scheduledAt,
    });

    expect(updated).toMatchObject({
      scheduleType: "one-time",
      cronExpression: null,
      intervalSeconds: null,
      anchorAt: null,
    });
    expect(updated!.scheduledAt?.getTime()).toBe(scheduledAt.getTime());
    expect(updated!.nextRunAt?.getTime()).toBe(scheduledAt.getTime());
    expect(updated!.nextRunAt?.getTime()).not.toBe(previousNextRunAt);
  });

  it("switches a completed one-time schedule to interval and re-arms it", async () => {
    const oneTime = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "One-time to interval",
      prompt: "p",
      scheduleType: "one-time",
      scheduledAt: new Date(Date.now() + 3_600_000),
      timezone: "UTC",
    });
    await handle.db
      .update(agentSchedules)
      .set({ enabled: false, status: "completed", nextRunAt: null })
      .where(eq(agentSchedules.id, oneTime.id));
    const anchorAt = new Date(Date.now() - 3_600_000);

    const updated = await updateAgentSchedule(USER, oneTime.id, {
      scheduleType: "interval",
      intervalSeconds: 900,
      anchorAt,
    });

    expect(updated).toMatchObject({
      scheduleType: "interval",
      cronExpression: null,
      scheduledAt: null,
      intervalSeconds: 900,
      enabled: true,
      status: "active",
    });
    expect(updated!.anchorAt?.getTime()).toBe(anchorAt.getTime());
    expect(updated!.nextRunAt?.getTime()).toBe(
      calculateNextIntervalRun(anchorAt, 900).getTime(),
    );
  });

  it("switches interval to recurring and clears interval fields", async () => {
    const interval = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Interval to recurring",
      prompt: "p",
      scheduleType: "interval",
      intervalSeconds: 300,
      anchorAt: new Date(),
      timezone: "UTC",
    });
    const previousNextRunAt = interval.nextRunAt!.getTime();

    const updated = await updateAgentSchedule(USER, interval.id, {
      scheduleType: "recurring",
      cronExpression: "0 2 * * *",
    });

    expect(updated).toMatchObject({
      scheduleType: "recurring",
      cronExpression: "0 2 * * *",
      scheduledAt: null,
      intervalSeconds: null,
      anchorAt: null,
    });
    expect(updated!.nextRunAt).toBeInstanceOf(Date);
    expect(updated!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(updated!.nextRunAt!.getTime()).not.toBe(previousNextRunAt);
  });

  it("never persists cross-type timing fields or raw timestamp strings", async () => {
    const recurring = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Recurring",
      prompt: "p",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
      timezone: "UTC",
    });

    const updated = await updateAgentSchedule(USER, recurring.id, {
      anchorAt: "raw-invalid-date",
      intervalSeconds: 300,
      scheduledAt: "also-not-a-date",
    });
    expect(updated).toMatchObject({
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
      scheduledAt: null,
      intervalSeconds: null,
      anchorAt: null,
    });
  });

  it("re-arms an interval row after firing without completing it", async () => {
    const anchorAt = new Date(Date.now() - 3_600_000);
    const created = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Re-arm",
      prompt: "p",
      scheduleType: "interval",
      intervalSeconds: 300,
      anchorAt,
      timezone: "UTC",
    });

    await markScheduleFired(created.id);

    const row = await getScheduleRow(created.id);
    expect(row.enabled).toBe(true);
    expect(row.status).toBe("active");
    expect(row.lastRunAt).toBeInstanceOf(Date);
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    {
      id: "malformed-recurring",
      scheduleType: "recurring" as const,
      cronExpression: null,
      intervalSeconds: null,
      anchorAt: null,
    },
    {
      id: "malformed-interval",
      scheduleType: "interval" as const,
      cronExpression: null,
      intervalSeconds: 300,
      anchorAt: null,
    },
  ])(
    "clears stale nextRunAt after firing malformed $scheduleType rows",
    async (timing) => {
      await handle.db.insert(agentSchedules).values({
        id: timing.id,
        userId: USER,
        projectId: PROJECT,
        name: timing.id,
        prompt: "p",
        scheduleType: timing.scheduleType,
        cronExpression: timing.cronExpression,
        intervalSeconds: timing.intervalSeconds,
        anchorAt: timing.anchorAt,
        timezone: "UTC",
        nextRunAt: new Date(Date.now() - 60_000),
      });

      await markScheduleFired(timing.id);

      const row = await getScheduleRow(timing.id);
      expect(row.lastRunAt).toBeInstanceOf(Date);
      expect(row.nextRunAt).toBeNull();
    },
  );

  it("recomputes nextRunAt when re-enabling an interval row", async () => {
    const anchorAt = new Date(Date.now() - 3_600_000);
    const created = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Re-enable",
      prompt: "p",
      scheduleType: "interval",
      intervalSeconds: 300,
      anchorAt,
      timezone: "UTC",
      enabled: false,
    });
    await handle.db
      .update(agentSchedules)
      .set({
        nextRunAt: new Date(Date.now() - 60_000),
        status: "paused",
      })
      .where(eq(agentSchedules.id, created.id));

    const updated = await updateAgentSchedule(USER, created.id, {
      enabled: true,
    });
    expect(updated!.enabled).toBe(true);
    expect(updated!.status).toBe("active");
    expect(updated!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(updated!.nextRunAt!.getTime()).toBe(
      calculateNextIntervalRun(anchorAt, 300).getTime(),
    );
  });

  it("persists scheduler nextRunAt without touching updatedAt", async () => {
    const created = await createAgentSchedule(USER, {
      projectId: PROJECT,
      name: "Bookkeeping",
      prompt: "p",
      scheduleType: "interval",
      intervalSeconds: 300,
      anchorAt: new Date(),
      timezone: "UTC",
    });
    const originalUpdatedAt = new Date(Date.now() - 3_600_000);
    await handle.db
      .update(agentSchedules)
      .set({ updatedAt: originalUpdatedAt })
      .where(eq(agentSchedules.id, created.id));

    const nextRunAt = new Date(Date.now() + 30_000);
    await persistNextRunAt(created.id, nextRunAt);

    const row = await getScheduleRow(created.id);
    expect(row.nextRunAt?.getTime()).toBe(nextRunAt.getTime());
    expect(row.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
  });
});
