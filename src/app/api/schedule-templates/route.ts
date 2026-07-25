import { NextResponse } from "next/server";

import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import {
  createScheduleTemplate,
  getScheduleTemplates,
  ScheduleTemplateValidationError,
} from "@/services/schedule-template-service";
import { validateCronExpression } from "@/services/schedule-service";
import type { CreateScheduleTemplateInput } from "@/types/schedule-template";
import {
  normalizeScheduleTemplateCommands,
  validateScheduleTemplateOptions,
} from "@/lib/schedule-template-validation";
import { isValidIntervalSeconds, isValidTimezone } from "@/lib/schedule-validation";

function validateInput(input: CreateScheduleTemplateInput): string | null {
  if (!input.name?.trim()) return "Template name is required";
  if (!["one-time", "recurring", "interval"].includes(input.scheduleType)) {
    return "Invalid schedule type";
  }
  if (!normalizeScheduleTemplateCommands(input.commands)) {
    return "At least one command is required";
  }
  const optionsError = validateScheduleTemplateOptions(input);
  if (optionsError) return optionsError;
  const timezone =
    input.timezone === undefined ? "America/Los_Angeles" : input.timezone;
  if (!isValidTimezone(timezone)) return "Invalid timezone";
  if (
    input.scheduleType === "recurring" &&
    (!input.cronExpression ||
      !validateCronExpression(input.cronExpression, timezone))
  ) {
    return "A valid cron expression is required for recurring templates";
  }
  if (
    input.scheduleType === "interval" &&
    !isValidIntervalSeconds(input.intervalSeconds)
  ) {
    return "Interval must be between 1 minute and 30 days";
  }
  return null;
}

export const GET = withApiAuth(async (_request, { userId }) => {
  const templates = await getScheduleTemplates(userId);
  return NextResponse.json({ templates });
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<CreateScheduleTemplateInput>(request);
  if ("error" in result) return result.error;

  const validationError = validateInput(result.data);
  if (validationError) return errorResponse(validationError, 400);
  const commands = normalizeScheduleTemplateCommands(result.data.commands)!;

  try {
    const template = await createScheduleTemplate(userId, {
      ...result.data,
      name: result.data.name.trim(),
      commands,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof ScheduleTemplateValidationError) {
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }
});
