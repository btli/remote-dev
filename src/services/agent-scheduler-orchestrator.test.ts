// @vitest-environment node
/**
 * AgentSchedulerOrchestrator interval tests.
 *
 * Registration and post-fire bookkeeping write DB state, so `@/db` is backed
 * by a real libsql database with the full generated schema. Real agent
 * launches are stubbed: execution success means launchAgentRun resolved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  createTestDb,
  type TestDbHandle,
} from "./__tests__/migration-test-db";

let handle: TestDbHandle;

const mockedLog = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@/db", () => ({
  get db() {
    return handle.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => mockedLog,
}));
vi.mock("./agent-run-service", () => ({
  launchAgentRun: vi.fn(async () => ({ id: "agent-run-1" })),
}));

import { agentSchedulerOrchestrator } from "./agent-scheduler-orchestrator";
import * as AgentRunService from "./agent-run-service";
import * as AgentScheduleService from "./agent-schedule-service";
import { agentSchedules, projects, users } from "@/db/schema";

const USER = "agent-orch-user-1";
const PROJECT = "agent-orch-project-1";
const mockedLaunchAgentRun = vi.mocked(AgentRunService.launchAgentRun);

interface SeedScheduleOptions {
  id: string;
  intervalSeconds: number;
  anchorAt: Date;
  nextRunAt?: Date | null;
  timezone?: string;
}

async function seedSchedule(opts: SeedScheduleOptions): Promise<void> {
  await handle.db.insert(agentSchedules).values({
    id: opts.id,
    userId: USER,
    projectId: PROJECT,
    name: `schedule ${opts.id}`,
    agentProvider: "claude",
    agentFlags: "[]",
    prompt: "perform scheduled work",
    scheduleType: "interval",
    cronExpression: null,
    scheduledAt: null,
    intervalSeconds: opts.intervalSeconds,
    anchorAt: opts.anchorAt,
    timezone: opts.timezone ?? "UTC",
    enabled: true,
    status: "active",
    nextRunAt: opts.nextRunAt ?? null,
  });
}

async function seedRecurringSchedule(
  id: string,
  nextRunAt: Date | null,
): Promise<void> {
  await handle.db.insert(agentSchedules).values({
    id,
    userId: USER,
    projectId: PROJECT,
    name: `schedule ${id}`,
    agentProvider: "claude",
    agentFlags: "[]",
    prompt: "perform scheduled work",
    scheduleType: "recurring",
    cronExpression: "0 2 * * *",
    scheduledAt: null,
    intervalSeconds: null,
    anchorAt: null,
    timezone: "UTC",
    enabled: true,
    status: "active",
    nextRunAt,
  });
}

async function getScheduleRow(id: string) {
  const row = await handle.db.query.agentSchedules.findFirst({
    where: eq(agentSchedules.id, id),
  });
  expect(row).toBeDefined();
  return row!;
}

describe("AgentSchedulerOrchestrator registration", () => {
  beforeEach(async () => {
    handle = await createTestDb("rdv-agent-scheduler-orchestrator-test-");
    await handle.db
      .insert(users)
      .values({ id: USER, email: "agent-orch@example.com" });
    await handle.db
      .insert(projects)
      .values({ id: PROJECT, userId: USER, name: "Agent Orchestrator" });
    mockedLaunchAgentRun.mockClear();
    mockedLaunchAgentRun.mockResolvedValue({
      id: "agent-run-1",
    } as Awaited<ReturnType<typeof AgentRunService.launchAgentRun>>);
    for (const method of Object.values(mockedLog)) method.mockClear();
  });

  afterEach(async () => {
    await agentSchedulerOrchestrator.stop();
    handle.cleanup();
    vi.restoreAllMocks();
  });

  it("recomputes stale interval nextRunAt on startup without one-time catch-up", async () => {
    const anchorAt = new Date(Date.now() - 24 * 3_600_000);
    await seedSchedule({
      id: "stale-interval",
      intervalSeconds: 5 * 3_600,
      anchorAt,
      nextRunAt: new Date(Date.now() - 3_600_000),
    });

    await agentSchedulerOrchestrator.start();

    const row = await getScheduleRow("stale-interval");
    expect(row.enabled).toBe(true);
    expect(row.status).toBe("active");
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(agentSchedulerOrchestrator.getJobCount()).toBe(1);
    expect(mockedLaunchAgentRun).not.toHaveBeenCalled();
  });

  it("refreshes stale recurring nextRunAt on startup", async () => {
    const staleNextRunAt = new Date(Date.now() - 3_600_000);
    await seedRecurringSchedule("stale-recurring", staleNextRunAt);

    await agentSchedulerOrchestrator.start();

    const row = await getScheduleRow("stale-recurring");
    expect(row.enabled).toBe(true);
    expect(row.status).toBe("active");
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row.nextRunAt!.getTime()).not.toBe(staleNextRunAt.getTime());
    expect(agentSchedulerOrchestrator.getJobCount()).toBe(1);
    expect(mockedLaunchAgentRun).not.toHaveBeenCalled();
  });

  it("registers an interval as a single fire and re-registers it afterward", async () => {
    const anchorAt = new Date(Date.now() + 2_000);
    await seedSchedule({
      id: "firing-interval",
      intervalSeconds: 60,
      anchorAt,
      nextRunAt: anchorAt,
    });

    await agentSchedulerOrchestrator.start();
    expect(agentSchedulerOrchestrator.getJobCount()).toBe(1);

    await vi.waitFor(
      async () => {
        const row = await getScheduleRow("firing-interval");
        expect(row.lastRunAt).not.toBeNull();
      },
      { timeout: 8_000 },
    );

    const row = await getScheduleRow("firing-interval");
    expect(row.enabled).toBe(true);
    expect(row.status).toBe("active");
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(mockedLaunchAgentRun).toHaveBeenCalledTimes(1);
    expect(mockedLaunchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        projectId: PROJECT,
        source: "schedule",
        scheduleId: "firing-interval",
      }),
    );
    expect(agentSchedulerOrchestrator.getJobCount()).toBe(1);
  });

  it("contains interval registration errors when addJob receives a malformed row", async () => {
    await agentSchedulerOrchestrator.start();
    await seedSchedule({
      id: "invalid-timezone",
      intervalSeconds: 300,
      anchorAt: new Date(),
      timezone: "Mars/Olympus_Mons",
    });

    await expect(
      agentSchedulerOrchestrator.addJob("invalid-timezone"),
    ).resolves.toBe(false);
    expect(mockedLog.error).toHaveBeenCalledWith(
      "Failed to create agent cron job",
      expect.objectContaining({ scheduleId: "invalid-timezone" }),
    );
    expect(agentSchedulerOrchestrator.getJobCount()).toBe(0);
  });

  it("executes and re-arms an interval whose fire passes during registration", async () => {
    const anchorAt = new Date(Date.now() - 60_000);
    await seedSchedule({
      id: "slipped-interval",
      intervalSeconds: 60,
      anchorAt,
      nextRunAt: null,
    });

    const calculateNextIntervalRun = vi.spyOn(
      AgentScheduleService,
      "calculateNextIntervalRun",
    );
    calculateNextIntervalRun.mockImplementationOnce(
      () => new Date(Date.now() + 10),
    );
    const persistNextRunAt = vi.spyOn(
      AgentScheduleService,
      "persistNextRunAt",
    );
    const realPersistNextRunAt = persistNextRunAt.getMockImplementation();
    persistNextRunAt.mockImplementationOnce(async (scheduleId, nextRunAt) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (realPersistNextRunAt) {
        await realPersistNextRunAt(scheduleId, nextRunAt);
      }
    });

    await agentSchedulerOrchestrator.start();

    await vi.waitFor(
      async () => {
        const row = await getScheduleRow("slipped-interval");
        expect(row.lastRunAt).not.toBeNull();
        expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
        expect(mockedLaunchAgentRun).toHaveBeenCalledTimes(1);
        expect(agentSchedulerOrchestrator.getJobCount()).toBe(1);
      },
      { timeout: 5_000 },
    );

    expect(mockedLog.warn).toHaveBeenCalledWith(
      "Interval fire passed during registration; executing immediately",
      expect.objectContaining({ scheduleId: "slipped-interval" }),
    );
    calculateNextIntervalRun.mockRestore();
    persistNextRunAt.mockRestore();
  });
});
