import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { scheduleTemplates } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type {
  CreateScheduleTemplateInput,
  ScheduleTemplate,
  ScheduleTemplateCommand,
  UpdateScheduleTemplateInput,
} from "@/types/schedule-template";

const log = createLogger("ScheduleTemplateService");

function parseCommands(commandsJson: string, templateId: string): ScheduleTemplateCommand[] {
  try {
    const commands: unknown = JSON.parse(commandsJson);
    return Array.isArray(commands) ? (commands as ScheduleTemplateCommand[]) : [];
  } catch (error) {
    log.error("Failed to parse schedule template commands", {
      templateId,
      error: String(error),
    });
    return [];
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
      timezone: input.timezone ?? "America/Los_Angeles",
      maxRetries: input.maxRetries ?? 0,
      retryDelaySeconds: input.retryDelaySeconds ?? 60,
      timeoutSeconds: input.timeoutSeconds ?? 300,
      commandsJson: JSON.stringify(input.commands),
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
      intervalSeconds:
        nextType === "interval"
          ? input.intervalSeconds !== undefined
            ? input.intervalSeconds
            : existing.intervalSeconds
          : null,
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.maxRetries !== undefined
        ? { maxRetries: input.maxRetries }
        : {}),
      ...(input.retryDelaySeconds !== undefined
        ? { retryDelaySeconds: input.retryDelaySeconds }
        : {}),
      ...(input.timeoutSeconds !== undefined
        ? { timeoutSeconds: input.timeoutSeconds }
        : {}),
      ...(input.commands !== undefined
        ? { commandsJson: JSON.stringify(input.commands) }
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
