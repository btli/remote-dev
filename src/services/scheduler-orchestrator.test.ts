// @vitest-environment node
/**
 * SchedulerOrchestrator tests — missed-fire persistence, the bounded
 * grace-window catch-up for past-due one-time schedules, closed-session
 * cancellation, and stale-nextRunAt healing at registration.
 *
 * The registration decisions write DB state, so `@/db` is backed by a REAL
 * libsql database with the full generated schema (migration-test-db helper).
 * Tmux is stubbed: execution success only means sendKeys resolved.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb, type TestDbHandle } from "./__tests__/migration-test-db";

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
vi.mock("./tmux-service", () => ({
  sessionExists: vi.fn(async () => true),
  sendKeys: vi.fn(async () => undefined),
}));

import {
  schedulerOrchestrator,
  classifyOneTimeRegistration,
  MISSED_FIRE_GRACE_MS,
} from "./scheduler-orchestrator";
import * as TmuxService from "./tmux-service";
import {
  projects,
  scheduleCommands,
  scheduleExecutions,
  sessionSchedules,
  terminalSessions,
  users,
} from "@/db/schema";
import type { SessionStatus } from "@/types/session";

const USER = "orch-user-1";

const mockedSendKeys = vi.mocked(TmuxService.sendKeys);
const mockedSessionExists = vi.mocked(TmuxService.sessionExists);

async function seedSession(id: string, status: SessionStatus = "active"): Promise<void> {
  await handle.db.insert(terminalSessions).values({
    id,
    userId: USER,
    name: `session ${id}`,
    tmuxSessionName: `rdv-${id}`,
    projectId: "project-1",
    status,
  });
}

interface SeedScheduleOptions {
  id: string;
  sessionId: string;
  scheduleType: "one-time" | "recurring";
  scheduledAt?: Date;
  cronExpression?: string;
  nextRunAt?: Date | null;
}

async function seedSchedule(opts: SeedScheduleOptions): Promise<void> {
  await handle.db.insert(sessionSchedules).values({
    id: opts.id,
    userId: USER,
    sessionId: opts.sessionId,
    name: `schedule ${opts.id}`,
    scheduleType: opts.scheduleType,
    scheduledAt: opts.scheduledAt ?? null,
    cronExpression: opts.cronExpression ?? null,
    timezone: "UTC",
    enabled: true,
    status: "active",
    nextRunAt: opts.nextRunAt ?? null,
  });
  await handle.db.insert(scheduleCommands).values({
    id: `${opts.id}-cmd-0`,
    scheduleId: opts.id,
    command: "echo scheduled",
    order: 0,
  });
}

async function getScheduleRow(id: string) {
  const row = await handle.db.query.sessionSchedules.findFirst({
    where: eq(sessionSchedules.id, id),
  });
  expect(row).toBeDefined();
  return row!;
}

describe("classifyOneTimeRegistration", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("registers schedules whose fire time is still in the future", () => {
    expect(
      classifyOneTimeRegistration(new Date(now.getTime() + 1), now)
    ).toBe("register");
    expect(
      classifyOneTimeRegistration(new Date(now.getTime() + 3_600_000), now)
    ).toBe("register");
  });

  it("fires immediately when the fire time just passed (lateness 0)", () => {
    expect(classifyOneTimeRegistration(now, now)).toBe("fire-now");
  });

  it("fires immediately up to and including the grace boundary", () => {
    expect(
      classifyOneTimeRegistration(
        new Date(now.getTime() - MISSED_FIRE_GRACE_MS + 1),
        now
      )
    ).toBe("fire-now");
    expect(
      classifyOneTimeRegistration(
        new Date(now.getTime() - MISSED_FIRE_GRACE_MS),
        now
      )
    ).toBe("fire-now");
  });

  it("marks as missed beyond the grace window", () => {
    expect(
      classifyOneTimeRegistration(
        new Date(now.getTime() - MISSED_FIRE_GRACE_MS - 1),
        now
      )
    ).toBe("mark-missed");
  });

  it("respects a custom grace window", () => {
    expect(
      classifyOneTimeRegistration(new Date(now.getTime() - 500), now, 1000)
    ).toBe("fire-now");
    expect(
      classifyOneTimeRegistration(new Date(now.getTime() - 1500), now, 1000)
    ).toBe("mark-missed");
  });
});

describe("SchedulerOrchestrator registration", () => {
  beforeEach(async () => {
    handle = await createTestDb("rdv-scheduler-orchestrator-test-");
    await handle.db.insert(users).values({ id: USER, email: "orch@example.com" });
    await handle.db
      .insert(projects)
      .values({ id: "project-1", userId: USER, name: "Test Project" });
    mockedSendKeys.mockClear();
    mockedSessionExists.mockClear();
    mockedSessionExists.mockResolvedValue(true);
  });

  afterEach(async () => {
    await schedulerOrchestrator.stop();
    handle.cleanup();
  });

  it("cancels schedules whose session is closed (recurring included)", async () => {
    await seedSession("closed-session", "closed");
    await seedSchedule({
      id: "orphan-recurring",
      sessionId: "closed-session",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
    });

    await schedulerOrchestrator.start();

    const row = await getScheduleRow("orphan-recurring");
    expect(row.enabled).toBe(false);
    expect(row.status).toBe("cancelled");
    expect(schedulerOrchestrator.getJobCount()).toBe(0);
  });

  it("cancels schedules whose session row is missing entirely", async () => {
    // A dangling sessionId can exist in prod (FK enforcement is off on the
    // default SQLite backend); relax FKs for this seed to reproduce it.
    await handle.client.execute("PRAGMA foreign_keys=OFF");
    await seedSchedule({
      id: "orphan-missing",
      sessionId: "no-such-session",
      scheduleType: "one-time",
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    await handle.client.execute("PRAGMA foreign_keys=ON");

    await schedulerOrchestrator.start();

    const row = await getScheduleRow("orphan-missing");
    expect(row.enabled).toBe(false);
    expect(row.status).toBe("cancelled");
  });

  it("marks a one-time schedule beyond the grace window as missed without executing", async () => {
    await seedSession("open-session");
    await seedSchedule({
      id: "too-late",
      sessionId: "open-session",
      scheduleType: "one-time",
      scheduledAt: new Date(Date.now() - MISSED_FIRE_GRACE_MS - 60_000),
    });

    await schedulerOrchestrator.start();

    const row = await getScheduleRow("too-late");
    expect(row.enabled).toBe(false);
    expect(row.status).toBe("missed");
    expect(schedulerOrchestrator.getJobCount()).toBe(0);
    expect(mockedSendKeys).not.toHaveBeenCalled();

    const executions = await handle.db.query.scheduleExecutions.findMany({
      where: eq(scheduleExecutions.scheduleId, "too-late"),
    });
    expect(executions).toHaveLength(0);
  });

  it("fires a one-time schedule within the grace window through the normal execution path", async () => {
    await seedSession("open-session");
    await seedSchedule({
      id: "late-but-ok",
      sessionId: "open-session",
      scheduleType: "one-time",
      scheduledAt: new Date(Date.now() - 60_000),
    });

    await schedulerOrchestrator.start();

    // The catch-up fire is intentionally fire-and-forget so it cannot block
    // startup registration; wait for the completion write.
    await vi.waitFor(async () => {
      const row = await getScheduleRow("late-but-ok");
      expect(row.status).toBe("completed");
    });

    const row = await getScheduleRow("late-but-ok");
    expect(row.enabled).toBe(false);
    expect(row.lastRunStatus).toBe("success");

    // Exactly one keystroke send — no double-fire from the placeholder job.
    expect(mockedSendKeys).toHaveBeenCalledTimes(1);
    expect(mockedSendKeys).toHaveBeenCalledWith(
      "rdv-open-session",
      "echo scheduled",
      true
    );

    // Execution row inserted via the same path croner-triggered fires use.
    const executions = await handle.db.query.scheduleExecutions.findMany({
      where: eq(scheduleExecutions.scheduleId, "late-but-ok"),
    });
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe("success");

    // One-time job removed from the in-memory map after execution.
    expect(schedulerOrchestrator.getJobCount()).toBe(0);
  });

  it("persists a fresh nextRunAt for recurring schedules whose stored value is stale", async () => {
    await seedSession("open-session");
    const staleNextRun = new Date(Date.now() - 3_600_000);
    await seedSchedule({
      id: "stale-recurring",
      sessionId: "open-session",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
      nextRunAt: staleNextRun,
    });

    await schedulerOrchestrator.start();

    const row = await getScheduleRow("stale-recurring");
    expect(row.enabled).toBe(true);
    expect(row.status).toBe("active");
    expect(row.nextRunAt).not.toBeNull();
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(schedulerOrchestrator.getJobCount()).toBe(1);
  });
});
