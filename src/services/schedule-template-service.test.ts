// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  createScheduleTemplate,
  deleteScheduleTemplate,
  getScheduleTemplate,
  getScheduleTemplates,
  recordScheduleTemplateUsage,
  ScheduleTemplateValidationError,
  updateScheduleTemplate,
} from "./schedule-template-service";
import { scheduleTemplates, users } from "@/db/schema";

const USER_A = "schedule-template-user-a";
const USER_B = "schedule-template-user-b";

describe("ScheduleTemplateService", () => {
  beforeEach(async () => {
    handle = await createTestDb("rdv-schedule-template-service-test-");
    await handle.db.insert(users).values([
      { id: USER_A, email: "template-a@example.com" },
      { id: USER_B, email: "template-b@example.com" },
    ]);
  });

  afterEach(() => {
    handle.cleanup();
  });

  it("creates, parses, lists, and updates a reusable interval template", async () => {
    const created = await createScheduleTemplate(USER_A, {
      name: "Periodic health check",
      description: "Check the local service",
      scheduleType: "interval",
      intervalSeconds: 18_000,
      timezone: "UTC",
      maxRetries: 2,
      retryDelaySeconds: 15,
      timeoutSeconds: 120,
      commands: [
        {
          command: "curl localhost:6001/health",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    });

    expect(created.intervalSeconds).toBe(18_000);
    expect(created.cronExpression).toBeNull();
    expect(created.commands).toEqual([
      {
        command: "curl localhost:6001/health",
        order: 0,
        delayBeforeSeconds: 0,
        continueOnError: false,
      },
    ]);

    const listed = await getScheduleTemplates(USER_A);
    expect(listed.map((item) => item.id)).toEqual([created.id]);

    const updated = await updateScheduleTemplate(created.id, USER_A, {
      name: "Renamed health check",
      scheduleType: "recurring",
      cronExpression: "0 * * * *",
    });
    expect(updated?.name).toBe("Renamed health check");
    expect(updated?.scheduleType).toBe("recurring");
    expect(updated?.cronExpression).toBe("0 * * * *");
    expect(updated?.intervalSeconds).toBeNull();
  });

  it("scopes reads, updates, deletes, and usage recording by user", async () => {
    const created = await createScheduleTemplate(USER_A, {
      name: "Owned template",
      scheduleType: "one-time",
      commands: [
        {
          command: "echo once",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    });

    expect(await getScheduleTemplate(created.id, USER_B)).toBeNull();
    expect(
      await updateScheduleTemplate(created.id, USER_B, { name: "Stolen" })
    ).toBeNull();
    expect(await recordScheduleTemplateUsage(created.id, USER_B)).toBe(false);
    expect(await deleteScheduleTemplate(created.id, USER_B)).toBe(false);

    const ownerCopy = await getScheduleTemplate(created.id, USER_A);
    expect(ownerCopy?.name).toBe("Owned template");
  });

  it("increments usage atomically and updates last-used time", async () => {
    const created = await createScheduleTemplate(USER_A, {
      name: "Used template",
      scheduleType: "one-time",
      commands: [
        {
          command: "echo once",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    });

    await Promise.all([
      recordScheduleTemplateUsage(created.id, USER_A),
      recordScheduleTemplateUsage(created.id, USER_A),
    ]);

    const used = await getScheduleTemplate(created.id, USER_A);
    expect(used?.usageCount).toBe(2);
    expect(used?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("deletes an owned template", async () => {
    const created = await createScheduleTemplate(USER_A, {
      name: "Disposable",
      scheduleType: "one-time",
      commands: [
        {
          command: "echo once",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    });

    expect(await deleteScheduleTemplate(created.id, USER_A)).toBe(true);
    expect(await getScheduleTemplate(created.id, USER_A)).toBeNull();
  });

  it("rejects invalid timezone, numeric, and command inputs in the service", async () => {
    const base = {
      name: "Invalid template",
      scheduleType: "one-time" as const,
      commands: [
        {
          command: "echo once",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    };

    await expect(
      createScheduleTemplate(USER_A, {
        ...base,
        timezone: "Mars/Olympus",
      })
    ).rejects.toThrow("Invalid timezone");
    await expect(
      createScheduleTemplate(USER_A, {
        ...base,
        maxRetries: 11,
      })
    ).rejects.toThrow("Max retries");
    await expect(
      createScheduleTemplate(USER_A, {
        ...base,
        commands: [{ ...base.commands[0], continueOnError: "yes" as never }],
      })
    ).rejects.toThrow("valid command");
  });

  it("rejects invalid recurring cron expressions with a typed validation error", async () => {
    const invalidCreate = createScheduleTemplate(USER_A, {
      name: "Broken recurring template",
      scheduleType: "recurring",
      cronExpression: "not a cron expression",
      timezone: "UTC",
      commands: [
        {
          command: "echo recurring",
          order: 0,
          delayBeforeSeconds: 0,
          continueOnError: false,
        },
      ],
    });

    await expect(invalidCreate).rejects.toMatchObject({
      name: "ScheduleTemplateValidationError",
      code: "INVALID_CRON_EXPRESSION",
    });
    await expect(invalidCreate).rejects.toBeInstanceOf(
      ScheduleTemplateValidationError
    );
  });

  it("filters malformed stored commands and defaults optional fields", async () => {
    await handle.db.insert(scheduleTemplates).values({
      id: "malformed-commands",
      userId: USER_A,
      name: "Legacy template",
      scheduleType: "one-time",
      commandsJson: JSON.stringify([
        null,
        { nope: true },
        { command: "echo defaulted" },
        {
          command: "echo configured",
          order: 7,
          delayBeforeSeconds: 5,
          continueOnError: true,
        },
      ]),
    });

    const template = await getScheduleTemplate("malformed-commands", USER_A);
    expect(template?.commands).toEqual([
      {
        command: "echo defaulted",
        order: 2,
        delayBeforeSeconds: 0,
        continueOnError: false,
      },
      {
        command: "echo configured",
        order: 7,
        delayBeforeSeconds: 5,
        continueOnError: true,
      },
    ]);
  });
});
