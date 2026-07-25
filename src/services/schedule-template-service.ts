import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { scheduleTemplates } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
  normalizeScheduleTemplateCommands,
  validateScheduleTemplateOptions,
} from "@/lib/schedule-template-validation";
import { isValidIntervalSeconds, isValidTimezone } from "@/lib/schedule-validation";
import type {
  CreateScheduleTemplateInput,
  ScheduleTemplate,
  ScheduleTemplateCommand,
  UpdateScheduleTemplateInput,
} from "@/types/schedule-template";
import type { ScheduleType } from "@/types/schedule";

const log = createLogger("ScheduleTemplateService");

function parseCommands(commandsJson: string, templateId: string): ScheduleTemplateCommand[] {
  try {
    const commands: unknown = JSON.parse(commandsJson);
    if (!Array.isArray(commands)) return [];

    return commands.flatMap((entry, index) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("command" in entry) ||
        typeof entry.command !== "string"
      ) {
        return [];
      }
      const order =
        "order" in entry &&
        Number.isInteger(entry.order) &&
        (entry.order as number) >= 0
          ? (entry.order as number)
          : index;
      const delayBeforeSeconds =
        "delayBeforeSeconds" in entry &&
        Number.isInteger(entry.delayBeforeSeconds) &&
        (entry.delayBeforeSeconds as number) >= 0
          ? (entry.delayBeforeSeconds as number)
          : 0;
      const continueOnError =
        "continueOnError" in entry &&
        typeof entry.continueOnError === "boolean"
          ? entry.continueOnError
          : false;
      return [{
        command: entry.command,
        order,
        delayBeforeSeconds,
        continueOnError,
      }];
    });
  } catch (error) {
    log.error("Failed to parse schedule template commands", {
      templateId,
      error: String(error),
    });
    return [];
  }
}

function validateTemplateConfiguration(input: {
  scheduleType: ScheduleType;
  timezone: string;
  intervalSeconds?: number | null;
  maxRetries?: number;
  retryDelaySeconds?: number;
  timeoutSeconds?: number;
}): void {
  if (!isValidTimezone(input.timezone)) {
    throw new Error("Invalid timezone");
  }
  const optionsError = validateScheduleTemplateOptions(input);
  if (optionsError) throw new Error(optionsError);
  if (
    input.scheduleType === "interval" &&
    !isValidIntervalSeconds(input.intervalSeconds)
  ) {
    throw new Error("Interval must be between 1 minute and 30 days");
  }
}

function mapTemplate(
  row: typeof scheduleTemplates.$inferSelect
): ScheduleTemplate {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    scheduleType: row.scheduleType,
    cronExpression: row.cronExpression,
    intervalSeconds: row.intervalSeconds,
    timezone: row.timezone,
    maxRetries: row.maxRetries,
    retryDelaySeconds: row.retryDelaySeconds,
    timeoutSeconds: row.timeoutSeconds,
    commands: parseCommands(row.commandsJson, row.id),
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function getScheduleTemplates(
  userId: string
): Promise<ScheduleTemplate[]> {
  const rows = await db
    .select()
    .from(scheduleTemplates)
    .where(eq(scheduleTemplates.userId, userId))
    .orderBy(desc(scheduleTemplates.usageCount));
  return rows.map(mapTemplate);
}

export async function getScheduleTemplate(
  templateId: string,
  userId: string
): Promise<ScheduleTemplate | null> {
  const [row] = await db
    .select()
    .from(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.id, templateId),
        eq(scheduleTemplates.userId, userId)
      )
    )
    .limit(1);
  return row ? mapTemplate(row) : null;
}

export async function createScheduleTemplate(
  userId: string,
  input: CreateScheduleTemplateInput
): Promise<ScheduleTemplate> {
  const timezone =
    input.timezone === undefined ? "America/Los_Angeles" : input.timezone;
  validateTemplateConfiguration({
    ...input,
    timezone,
    intervalSeconds:
      input.scheduleType === "interval" ? input.intervalSeconds : null,
  });
  const commands = normalizeScheduleTemplateCommands(input.commands);
  if (!commands) throw new Error("At least one valid command is required");

  const [row] = await db
    .insert(scheduleTemplates)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      scheduleType: input.scheduleType,
      cronExpression:
        input.scheduleType === "recurring" ? input.cronExpression ?? null : null,
      intervalSeconds:
        input.scheduleType === "interval" ? input.intervalSeconds ?? null : null,
      timezone,
      maxRetries: input.maxRetries ?? 0,
      retryDelaySeconds: input.retryDelaySeconds ?? 60,
      timeoutSeconds: input.timeoutSeconds ?? 300,
      commandsJson: JSON.stringify(commands),
    })
    .returning();

  log.info("Created schedule template", { templateId: row.id, userId });
  return mapTemplate(row);
}

export async function updateScheduleTemplate(
  templateId: string,
  userId: string,
  input: UpdateScheduleTemplateInput
): Promise<ScheduleTemplate | null> {
  const existing = await getScheduleTemplate(templateId, userId);
  if (!existing) return null;

  const nextType = input.scheduleType ?? existing.scheduleType;
  const timezone =
    input.timezone === undefined ? existing.timezone : input.timezone;
  const intervalSeconds =
    nextType === "interval"
      ? input.intervalSeconds !== undefined
        ? input.intervalSeconds
        : existing.intervalSeconds
      : null;
  validateTemplateConfiguration({
    ...input,
    scheduleType: nextType,
    timezone,
    intervalSeconds,
  });
  const commands =
    input.commands !== undefined
      ? normalizeScheduleTemplateCommands(input.commands)
      : undefined;
  if (input.commands !== undefined && !commands) {
    throw new Error("At least one valid command is required");
  }

  const [row] = await db
    .update(scheduleTemplates)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.scheduleType !== undefined
        ? { scheduleType: input.scheduleType }
        : {}),
      cronExpression:
        nextType === "recurring"
          ? input.cronExpression !== undefined
            ? input.cronExpression
            : existing.cronExpression
          : null,
      intervalSeconds,
      ...(input.timezone !== undefined ? { timezone } : {}),
      ...(input.maxRetries !== undefined
        ? { maxRetries: input.maxRetries }
        : {}),
      ...(input.retryDelaySeconds !== undefined
        ? { retryDelaySeconds: input.retryDelaySeconds }
        : {}),
      ...(input.timeoutSeconds !== undefined
        ? { timeoutSeconds: input.timeoutSeconds }
        : {}),
      ...(commands !== undefined
        ? { commandsJson: JSON.stringify(commands) }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduleTemplates.id, templateId),
        eq(scheduleTemplates.userId, userId)
      )
    )
    .returning();

  if (!row) return null;
  log.info("Updated schedule template", { templateId, userId });
  return mapTemplate(row);
}

export async function deleteScheduleTemplate(
  templateId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .delete(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.id, templateId),
        eq(scheduleTemplates.userId, userId)
      )
    )
    .returning({ id: scheduleTemplates.id });

  if (rows.length > 0) {
    log.info("Deleted schedule template", { templateId, userId });
  }
  return rows.length > 0;
}

export async function recordScheduleTemplateUsage(
  templateId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .update(scheduleTemplates)
    .set({
      usageCount: sql`${scheduleTemplates.usageCount} + 1`,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduleTemplates.id, templateId),
        eq(scheduleTemplates.userId, userId)
      )
    )
    .returning({ id: scheduleTemplates.id });
  return rows.length > 0;
}
