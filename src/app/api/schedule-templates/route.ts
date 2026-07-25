import { NextResponse } from "next/server";

import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import {
  createScheduleTemplate,
  getScheduleTemplates,
} from "@/services/schedule-template-service";
import { validateCronExpression } from "@/services/schedule-service";
import type { CreateScheduleTemplateInput } from "@/types/schedule-template";

function validateInput(input: CreateScheduleTemplateInput): string | null {
  if (!input.name?.trim()) return "Template name is required";
  if (!["one-time", "recurring", "interval"].includes(input.scheduleType)) {
    return "Invalid schedule type";
  }
  if (!input.commands?.length || input.commands.some((command) => !command.command?.trim())) {
    return "At least one command is required";
  }
  if (
    input.scheduleType === "recurring" &&
    (!input.cronExpression ||
      !validateCronExpression(
        input.cronExpression,
        input.timezone ?? "America/Los_Angeles"
      ))
  ) {
    return "A valid cron expression is required for recurring templates";
  }
  if (
    input.scheduleType === "interval" &&
    (input.intervalSeconds === null ||
      input.intervalSeconds === undefined ||
      !Number.isInteger(input.intervalSeconds) ||
      input.intervalSeconds < 60)
  ) {
    return "Interval must be at least 60 seconds";
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

  const template = await createScheduleTemplate(userId, {
    ...result.data,
    name: result.data.name.trim(),
  });
  return NextResponse.json(template, { status: 201 });
});
