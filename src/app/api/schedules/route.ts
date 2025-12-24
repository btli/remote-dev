import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";
import { notifyScheduleCreated } from "@/lib/scheduler-client";
import type { CreateScheduleInput } from "@/types/schedule";

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
    console.error("Error listing schedules:", error);
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
        console.warn("[API] Failed to notify scheduler of new schedule:", err)
      );
    }

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error("Error creating schedule:", error);
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to create schedule", 500);
  }
});
