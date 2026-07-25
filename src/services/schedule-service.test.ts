// @vitest-environment node
/**
 * ScheduleService lifecycle tests — session-close cancellation semantics and
 * the missed/cancelled persistence helpers (silent-schedule-cancellation fix).
 *
 * These behaviors ARE the SQL (which rows a session close touches, what it
 * stamps), so `@/db` is backed by a REAL libsql database with the full
 * generated schema via the shared migration-test-db helper.
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
  calculateNextIntervalRun,
  createSchedule,
  disableSessionSchedules,
  executeSchedule,
  markScheduleMissed,
  markScheduleCancelled,
  persistNextRunAt,
  updateSchedule,
} from "./schedule-service";
import { projects, sessionSchedules, terminalSessions, users } from "@/db/schema";
import type { ScheduleStatus } from "@/types/schedule";
import type { SessionStatus } from "@/types/session";

const USER = "sched-user-1";
const SESSION_A = "sched-session-a";
const SESSION_B = "sched-session-b";

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
  enabled?: boolean;
  status?: ScheduleStatus;
  updatedAt?: Date;
  nextRunAt?: Date | null;
  scheduledAt?: Date;
}

async function seedSchedule(opts: SeedScheduleOptions): Promise<void> {
  await handle.db.insert(sessionSchedules).values({
    id: opts.id,
    userId: USER,
    sessionId: opts.sessionId,
    name: `schedule ${opts.id}`,
    scheduleType: "one-time",
    scheduledAt: opts.scheduledAt ?? new Date(Date.now() + 3_600_000),
    timezone: "UTC",
    enabled: opts.enabled ?? true,
    status: opts.status ?? "active",
    nextRunAt: opts.nextRunAt ?? new Date(Date.now() + 3_600_000),
    createdAt: opts.updatedAt ?? new Date(),
    updatedAt: opts.updatedAt ?? new Date(),
  });
}

async function getScheduleRow(id: string) {
  const row = await handle.db.query.sessionSchedules.findFirst({
    where: eq(sessionSchedules.id, id),
  });
  expect(row).toBeDefined();
  return row!;
}

describe("ScheduleService lifecycle", () => {
  beforeEach(async () => {
    handle = await createTestDb("rdv-schedule-service-test-");
    await handle.db.insert(users).values({ id: USER, email: "sched@example.com" });
    await handle.db
      .insert(projects)
      .values({ id: "project-1", userId: USER, name: "Test Project" });
    await seedSession(SESSION_A);
    await seedSession(SESSION_B);
  });

  afterEach(() => {
    handle.cleanup();
  });

  describe("disableSessionSchedules", () => {
    it("cancels only pending (enabled) rows and returns the affected count", async () => {
      await seedSchedule({ id: "pending-1", sessionId: SESSION_A });
      await seedSchedule({ id: "pending-2", sessionId: SESSION_A });
      await seedSchedule({
        id: "already-disabled",
        sessionId: SESSION_A,
        enabled: false,
        status: "paused",
      });

      const count = await disableSessionSchedules(SESSION_A);
      expect(count).toBe(2);

      for (const id of ["pending-1", "pending-2"]) {
        const row = await getScheduleRow(id);
        expect(row.enabled).toBe(false);
        expect(row.status).toBe("cancelled");
      }

      // Non-pending row keeps its original status.
      const untouched = await getScheduleRow("already-disabled");
      expect(untouched.status).toBe("paused");
    });

    it("does not re-stamp completed rows (status and updatedAt preserved)", async () => {
      const originalUpdatedAt = new Date(Date.now() - 86_400_000);
      await seedSchedule({
        id: "completed-1",
        sessionId: SESSION_A,
        enabled: false,
        status: "completed",
        updatedAt: originalUpdatedAt,
      });
      await seedSchedule({ id: "pending-3", sessionId: SESSION_A });

      const count = await disableSessionSchedules(SESSION_A);
      expect(count).toBe(1);

      const completed = await getScheduleRow("completed-1");
      expect(completed.status).toBe("completed");
      expect(completed.enabled).toBe(false);
      // Forensics preserved — the close must not touch this row at all.
      expect(completed.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
    });

    it("leaves other sessions' schedules alone", async () => {
      await seedSchedule({ id: "a-pending", sessionId: SESSION_A });
      await seedSchedule({ id: "b-pending", sessionId: SESSION_B });

      const count = await disableSessionSchedules(SESSION_A);
      expect(count).toBe(1);

      const other = await getScheduleRow("b-pending");
      expect(other.enabled).toBe(true);
      expect(other.status).toBe("active");
    });

    it("returns 0 when the session has no pending schedules", async () => {
      await seedSchedule({
        id: "done",
        sessionId: SESSION_A,
        enabled: false,
        status: "completed",
      });

      expect(await disableSessionSchedules(SESSION_A)).toBe(0);
      expect(await disableSessionSchedules("no-such-session")).toBe(0);
    });
  });

  describe("markScheduleMissed / markScheduleCancelled", () => {
    it("markScheduleMissed disables the row and sets status=missed", async () => {
      const scheduledAt = new Date(Date.now() - 60_000);
      await seedSchedule({ id: "missed-1", sessionId: SESSION_A, scheduledAt });

      expect(await markScheduleMissed("missed-1", scheduledAt)).toBe(1);

      const row = await getScheduleRow("missed-1");
      expect(row.enabled).toBe(false);
      expect(row.status).toBe("missed");
    });

    it("markScheduleMissed does not stamp a row the user disabled concurrently", async () => {
      const scheduledAt = new Date(Date.now() - 60_000);
      await seedSchedule({
        id: "missed-disabled",
        sessionId: SESSION_A,
        enabled: false,
        status: "paused",
        scheduledAt,
      });

      expect(await markScheduleMissed("missed-disabled", scheduledAt)).toBe(0);

      const row = await getScheduleRow("missed-disabled");
      expect(row.enabled).toBe(false);
      expect(row.status).toBe("paused");
    });

    it("markScheduleMissed does not stamp a row rescheduled since the snapshot", async () => {
      const snapshotScheduledAt = new Date(Date.now() - 60_000);
      await seedSchedule({
        id: "missed-rescheduled",
        sessionId: SESSION_A,
        // User moved the fire time forward after the snapshot was read.
        scheduledAt: new Date(Date.now() + 3_600_000),
      });

      expect(
        await markScheduleMissed("missed-rescheduled", snapshotScheduledAt)
      ).toBe(0);

      const row = await getScheduleRow("missed-rescheduled");
      expect(row.enabled).toBe(true);
      expect(row.status).toBe("active");
    });

    it("markScheduleCancelled disables the row and sets status=cancelled", async () => {
      await seedSchedule({ id: "cancelled-1", sessionId: SESSION_A });

      expect(await markScheduleCancelled("cancelled-1")).toBe(1);

      const row = await getScheduleRow("cancelled-1");
      expect(row.enabled).toBe(false);
      expect(row.status).toBe("cancelled");
    });

    it("markScheduleCancelled does not stamp a row the user disabled concurrently", async () => {
      await seedSchedule({
        id: "cancelled-disabled",
        sessionId: SESSION_A,
        enabled: false,
        status: "paused",
      });

      expect(await markScheduleCancelled("cancelled-disabled")).toBe(0);

      const row = await getScheduleRow("cancelled-disabled");
      expect(row.enabled).toBe(false);
      expect(row.status).toBe("paused");
    });
  });

  describe("updateSchedule re-enable status reset", () => {
    it("resets 'cancelled' to 'active' when re-enabling (e.g. after a trash-restore)", async () => {
      await seedSchedule({
        id: "reenable-cancelled",
        sessionId: SESSION_A,
        enabled: false,
        status: "cancelled",
      });

      const updated = await updateSchedule("reenable-cancelled", USER, {
        enabled: true,
      });
      expect(updated.enabled).toBe(true);
      expect(updated.status).toBe("active");

      const row = await getScheduleRow("reenable-cancelled");
      expect(row.enabled).toBe(true);
      expect(row.status).toBe("active");
    });

    it("resets 'missed' to 'active' when re-enabling", async () => {
      await seedSchedule({
        id: "reenable-missed",
        sessionId: SESSION_A,
        enabled: false,
        status: "missed",
      });

      const updated = await updateSchedule("reenable-missed", USER, {
        enabled: true,
      });
      expect(updated.status).toBe("active");
    });

    it("keeps an explicitly provided status on re-enable", async () => {
      await seedSchedule({
        id: "reenable-explicit",
        sessionId: SESSION_A,
        enabled: false,
        status: "cancelled",
      });

      const updated = await updateSchedule("reenable-explicit", USER, {
        enabled: true,
        status: "paused",
      });
      expect(updated.status).toBe("paused");
    });

    it("does not reset 'completed' on re-enable (one-time completion is sticky)", async () => {
      await seedSchedule({
        id: "reenable-completed",
        sessionId: SESSION_A,
        enabled: false,
        status: "completed",
      });

      const updated = await updateSchedule("reenable-completed", USER, {
        enabled: true,
      });
      expect(updated.status).toBe("completed");
    });

    it("leaves status alone when disabling", async () => {
      await seedSchedule({ id: "disable-active", sessionId: SESSION_A });

      const updated = await updateSchedule("disable-active", USER, {
        enabled: false,
      });
      expect(updated.enabled).toBe(false);
      expect(updated.status).toBe("active");
    });
  });

  describe("persistNextRunAt", () => {
    it("updates nextRunAt without touching updatedAt", async () => {
      const originalUpdatedAt = new Date(Date.now() - 3_600_000);
      await seedSchedule({
        id: "recurring-1",
        sessionId: SESSION_A,
        updatedAt: originalUpdatedAt,
        nextRunAt: new Date(Date.now() - 60_000),
      });

      const next = new Date(Date.now() + 1_800_000);
      await persistNextRunAt("recurring-1", next);

      const row = await getScheduleRow("recurring-1");
      expect(row.nextRunAt?.getTime()).toBe(next.getTime());
      expect(row.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
    });
  });

  describe("interval schedules", () => {
    it("calculates before-anchor, boundary, and missed-run cases", () => {
      const anchor = new Date("2026-07-25T09:30:00.000Z");
      expect(
        calculateNextIntervalRun(
          anchor,
          5 * 3_600,
          new Date("2026-07-25T08:00:00.000Z")
        )
      ).toEqual(anchor);
      expect(
        calculateNextIntervalRun(anchor, 300, anchor)
      ).toEqual(new Date("2026-07-25T09:35:00.000Z"));
      expect(
        calculateNextIntervalRun(
          anchor,
          300,
          new Date("2026-07-25T09:35:00.000Z")
        )
      ).toEqual(new Date("2026-07-25T09:40:00.000Z"));
      expect(
        calculateNextIntervalRun(
          anchor,
          5 * 3_600,
          new Date("2026-07-28T12:00:00.000Z")
        )
      ).toEqual(new Date("2026-07-28T12:30:00.000Z"));
    });

    it("creates an interval schedule from a past anchor and skips missed ticks", async () => {
      const anchorAt = new Date(Date.now() - 3 * 3_600_000);
      const created = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Every five hours",
        scheduleType: "interval",
        intervalSeconds: 5 * 3_600,
        anchorAt: anchorAt.toISOString(),
        timezone: "UTC",
        commands: [{ command: "echo interval" }],
      });

      expect(created.intervalSeconds).toBe(18_000);
      expect(created.anchorAt?.getTime()).toBe(anchorAt.getTime());
      expect(created.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(created.nextRunAt!.getTime()).toBe(
        calculateNextIntervalRun(anchorAt, 18_000).getTime()
      );
    });

    it("rejects missing, short, and invalid interval configuration", async () => {
      const base = {
        sessionId: SESSION_A,
        name: "Invalid interval",
        scheduleType: "interval" as const,
        timezone: "UTC",
        commands: [{ command: "echo interval" }],
      };
      await expect(
        createSchedule(USER, { ...base, anchorAt: new Date().toISOString() })
      ).rejects.toMatchObject({ code: "INVALID_INTERVAL_SECONDS" });
      await expect(
        createSchedule(USER, {
          ...base,
          intervalSeconds: 59,
          anchorAt: new Date().toISOString(),
        })
      ).rejects.toMatchObject({ code: "INVALID_INTERVAL_SECONDS" });
      await expect(
        createSchedule(USER, {
          ...base,
          intervalSeconds: 60,
          anchorAt: "not-a-date",
        })
      ).rejects.toMatchObject({ code: "INVALID_ANCHOR_AT" });
      await expect(
        createSchedule(USER, {
          ...base,
          intervalSeconds: 2_592_001,
          anchorAt: new Date().toISOString(),
        })
      ).rejects.toMatchObject({ code: "INVALID_INTERVAL_SECONDS" });
    });

    it("updates interval cadence and cleans fields from the previous type", async () => {
      await seedSchedule({ id: "becomes-interval", sessionId: SESSION_A });
      const anchorAt = new Date(Date.now() - 3_600_000);
      const updated = await updateSchedule("becomes-interval", USER, {
        scheduleType: "interval",
        intervalSeconds: 900,
        anchorAt: anchorAt.toISOString(),
      });

      expect(updated.scheduleType).toBe("interval");
      expect(updated.intervalSeconds).toBe(900);
      expect(updated.anchorAt?.getTime()).toBe(anchorAt.getTime());
      expect(updated.scheduledAt).toBeNull();
      expect(updated.cronExpression).toBeNull();
      expect(updated.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects invalid interval values on update", async () => {
      const anchorAt = new Date(Date.now() - 3_600_000);
      const created = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Validated update",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: anchorAt.toISOString(),
        commands: [{ command: "echo interval" }],
      });

      await expect(
        updateSchedule(created.id, USER, { intervalSeconds: 59 })
      ).rejects.toMatchObject({ code: "INVALID_INTERVAL_SECONDS" });
      await expect(
        updateSchedule(created.id, USER, { intervalSeconds: 2_592_001 })
      ).rejects.toMatchObject({ code: "INVALID_INTERVAL_SECONDS" });
      await expect(
        updateSchedule(created.id, USER, { anchorAt: null })
      ).rejects.toMatchObject({ code: "ANCHOR_AT_REQUIRED" });
    });

    it("does not persist fields from other schedule types", async () => {
      const recurring = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Recurring",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        commands: [{ command: "echo recurring" }],
      });
      const recurringUpdated = await updateSchedule(recurring.id, USER, {
        anchorAt: new Date().toISOString(),
        intervalSeconds: 300,
      });
      expect(recurringUpdated.anchorAt).toBeNull();
      expect(recurringUpdated.intervalSeconds).toBeNull();

      const interval = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Interval",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: new Date().toISOString(),
        timezone: "UTC",
        commands: [{ command: "echo interval" }],
      });
      const intervalUpdated = await updateSchedule(interval.id, USER, {
        cronExpression: "*/5 * * * *",
      });
      expect(intervalUpdated.cronExpression).toBeNull();
    });

    it("can disable an interval row with a missing anchor", async () => {
      const now = new Date();
      await handle.db.insert(sessionSchedules).values({
        id: "corrupt-interval",
        userId: USER,
        sessionId: SESSION_A,
        name: "Corrupt interval",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: null,
        timezone: "UTC",
        enabled: true,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      const updated = await updateSchedule("corrupt-interval", USER, {
        enabled: false,
      });
      expect(updated.enabled).toBe(false);
      expect(updated.anchorAt).toBeNull();
    });

    it("recomputes nextRunAt when re-enabling an interval schedule", async () => {
      const anchorAt = new Date(Date.now() - 3_600_000);
      const created = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Re-enabled interval",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: anchorAt.toISOString(),
        timezone: "UTC",
        enabled: false,
        commands: [{ command: "echo interval" }],
      });
      await handle.db
        .update(sessionSchedules)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(sessionSchedules.id, created.id));

      const updated = await updateSchedule(created.id, USER, {
        enabled: true,
      });
      expect(updated.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(updated.nextRunAt!.getTime()).toBe(
        calculateNextIntervalRun(anchorAt, 300).getTime()
      );
    });

    it("re-arms an interval schedule after execution instead of completing it", async () => {
      const anchorAt = new Date(Date.now() - 3_600_000);
      const created = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Re-arm interval",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: anchorAt.toISOString(),
        timezone: "UTC",
        commands: [{ command: "echo interval" }],
      });

      await executeSchedule(created, `rdv-${SESSION_A}`);
      const row = await getScheduleRow(created.id);
      expect(row.enabled).toBe(true);
      expect(row.status).toBe("active");
      expect(row.lastRunStatus).toBe("success");
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("timezone validation", () => {
    it.each([
      {
        scheduleType: "one-time" as const,
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      {
        scheduleType: "recurring" as const,
        cronExpression: "0 * * * *",
      },
      {
        scheduleType: "interval" as const,
        intervalSeconds: 300,
        anchorAt: new Date().toISOString(),
      },
    ])("rejects an invalid timezone when creating $scheduleType schedules", async (fields) => {
      await expect(
        createSchedule(USER, {
          sessionId: SESSION_A,
          name: `Invalid ${fields.scheduleType}`,
          timezone: "Mars/Olympus",
          commands: [{ command: "echo invalid" }],
          ...fields,
        })
      ).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
    });

    it("rejects an invalid timezone when updating all schedule types", async () => {
      const oneTime = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "One time",
        scheduleType: "one-time",
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        timezone: "UTC",
        commands: [{ command: "echo once" }],
      });
      const recurring = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Recurring",
        scheduleType: "recurring",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        commands: [{ command: "echo recurring" }],
      });
      const interval = await createSchedule(USER, {
        sessionId: SESSION_A,
        name: "Interval",
        scheduleType: "interval",
        intervalSeconds: 300,
        anchorAt: new Date().toISOString(),
        timezone: "UTC",
        commands: [{ command: "echo interval" }],
      });

      for (const schedule of [oneTime, recurring, interval]) {
        await expect(
          updateSchedule(schedule.id, USER, { timezone: "Mars/Olympus" })
        ).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
      }
    });
  });

  describe("schedule type changes", () => {
    it.each([
      {
        id: "completed-to-recurring",
        updates: {
          scheduleType: "recurring" as const,
          cronExpression: "0 * * * *",
        },
      },
      {
        id: "completed-to-interval",
        updates: {
          scheduleType: "interval" as const,
          intervalSeconds: 300,
          anchorAt: new Date().toISOString(),
        },
      },
    ])("re-arms a completed one-time schedule when changing type", async ({ id, updates }) => {
      await seedSchedule({
        id,
        sessionId: SESSION_A,
        enabled: false,
        status: "completed",
      });

      const updated = await updateSchedule(id, USER, updates);
      expect(updated.status).toBe("active");
      expect(updated.enabled).toBe(true);
      expect(updated.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
