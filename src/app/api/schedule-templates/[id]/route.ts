import { NextResponse } from "next/server";

import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import {
  deleteScheduleTemplate,
  getScheduleTemplate,
  recordScheduleTemplateUsage,
  updateScheduleTemplate,
} from "@/services/schedule-template-service";
import { validateCronExpression } from "@/services/schedule-service";
import type { UpdateScheduleTemplateInput } from "@/types/schedule-template";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const template = await getScheduleTemplate(params!.id, userId);
  return template
    ? NextResponse.json(template)
    : errorResponse("Schedule template not found", 404);
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const existing = await getScheduleTemplate(params!.id, userId);
  if (!existing) return errorResponse("Schedule template not found", 404);

  const result = await parseJsonBody<UpdateScheduleTemplateInput>(request);
  if ("error" in result) return result.error;
  const input = result.data;
  const scheduleType = input.scheduleType ?? existing.scheduleType;
  const timezone = input.timezone ?? existing.timezone;
  const cronExpression =
    input.cronExpression !== undefined
      ? input.cronExpression
      : existing.cronExpression;
  const intervalSeconds =
    input.intervalSeconds !== undefined
      ? input.intervalSeconds
      : existing.intervalSeconds;

  if (input.name !== undefined && !input.name.trim()) {
    return errorResponse("Template name is required", 400);
  }
  if (!["one-time", "recurring", "interval"].includes(scheduleType)) {
    return errorResponse("Invalid schedule type", 400);
  }
  if (
    input.commands !== undefined &&
    (!input.commands.length ||
      input.commands.some((command) => !command.command?.trim()))
  ) {
    return errorResponse("At least one command is required", 400);
  }
  if (
    scheduleType === "recurring" &&
    (!cronExpression || !validateCronExpression(cronExpression, timezone))
  ) {
    return errorResponse(
      "A valid cron expression is required for recurring templates",
      400
    );
  }
  if (
    scheduleType === "interval" &&
    (intervalSeconds === null ||
      intervalSeconds === undefined ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 60)
  ) {
    return errorResponse("Interval must be at least 60 seconds", 400);
  }

  const template = await updateScheduleTemplate(params!.id, userId, {
    ...input,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  });
  return NextResponse.json(template);
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const deleted = await deleteScheduleTemplate(params!.id, userId);
  return deleted
    ? NextResponse.json({ success: true })
    : errorResponse("Schedule template not found", 404);
});

export const POST = withApiAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<{ action?: string }>(request);
  if ("error" in result) return result.error;
  if (result.data.action !== "use") {
    return errorResponse("Unknown action", 400);
  }

  const recorded = await recordScheduleTemplateUsage(params!.id, userId);
  return recorded
    ? NextResponse.json({ success: true })
    : errorResponse("Schedule template not found", 404);
});
