import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";
import { notifyScheduleCreated } from "@/lib/scheduler-client";
import type { CreateScheduleInput } from "@/types/schedule";
import { createLogger } from "@/lib/logger";
import { isValidIntervalSeconds, isValidTimezone } from "@/lib/schedule-validation";

const log = createLogger("api/schedules");

/**
 * GET /api/schedules - List user's schedules
 * Query params: sessionId (optional filter)
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId") ?? undefined;

    const schedules = await ScheduleService.listSchedules(userId, sessionId);
    return NextResponse.json({ schedules });
  } catch (error) {
    log.error("Error listing schedules", { error: String(error) });
    return errorResponse("Failed to list schedules", 500);
  }
});

/**
 * POST /api/schedules - Create a new schedule
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<CreateScheduleInput>(request);
    if ("error" in result) return result.error;
    const input = result.data;

    // Validate required fields
    if (!input.sessionId) {
      return errorResponse("Session ID is required", 400, "SESSION_ID_REQUIRED");
    }
    if (!input.name) {
      return errorResponse("Schedule name is required", 400, "NAME_REQUIRED");
    }

    // Validate schedule type-specific fields
    const scheduleType = input.scheduleType || "one-time";
    if (!["one-time", "recurring", "interval"].includes(scheduleType)) {
      return errorResponse("Invalid schedule type", 400, "INVALID_SCHEDULE_TYPE");
    }
    const timezone =
      input.timezone === undefined ? "America/Los_Angeles" : input.timezone;
    if (!isValidTimezone(timezone)) {
      return errorResponse("Invalid timezone", 400, "INVALID_TIMEZONE");
    }
    if (scheduleType === "recurring") {
      if (!input.cronExpression) {
        return errorResponse("Cron expression is required for recurring schedules", 400, "CRON_REQUIRED");
      }
    } else if (scheduleType === "one-time") {
      if (!input.scheduledAt) {
        return errorResponse("Scheduled time is required for one-time schedules", 400, "SCHEDULED_AT_REQUIRED");
      }
      // Validate scheduledAt is in the future
      const scheduledDate = new Date(input.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return errorResponse("Invalid scheduled time format", 400, "INVALID_SCHEDULED_AT");
      }
      if (scheduledDate <= new Date()) {
        return errorResponse("Scheduled time must be in the future", 400, "SCHEDULED_AT_IN_PAST");
      }
    } else {
      if (!isValidIntervalSeconds(input.intervalSeconds)) {
        return errorResponse(
          "Interval must be between 1 minute and 30 days",
          400,
          "INVALID_INTERVAL_SECONDS"
        );
      }
      if (!input.anchorAt) {
        return errorResponse(
          "Anchor time is required for interval schedules",
          400,
          "ANCHOR_AT_REQUIRED"
        );
      }
      if (isNaN(new Date(input.anchorAt).getTime())) {
        return errorResponse(
          "Invalid anchor time format",
          400,
          "INVALID_ANCHOR_AT"
        );
      }
    }

    if (!input.commands || input.commands.length === 0) {
      return errorResponse("At least one command is required", 400, "COMMANDS_REQUIRED");
    }

    const schedule = await ScheduleService.createSchedule(userId, input);

    // Notify terminal server's scheduler to add the job
    // This is fire-and-forget - if terminal server is down, the schedule
    // will be picked up when it starts and loads all enabled schedules
    if (schedule.enabled) {
      notifyScheduleCreated(schedule.id).catch((err) =>
        log.warn("Failed to notify scheduler of new schedule", { error: String(err) })
      );
    }

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    log.error("Error creating schedule", { error: String(error) });
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to create schedule", 500);
  }
});
