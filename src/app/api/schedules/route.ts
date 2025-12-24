import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";
import { schedulerOrchestrator } from "@/services/scheduler-orchestrator";
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
    if (!input.cronExpression) {
      return errorResponse("Cron expression is required", 400, "CRON_REQUIRED");
    }
    if (!input.commands || input.commands.length === 0) {
      return errorResponse("At least one command is required", 400, "COMMANDS_REQUIRED");
    }

    const schedule = await ScheduleService.createSchedule(userId, input);

    // Notify orchestrator to add the job
    if (schedule.enabled) {
      await schedulerOrchestrator.addJob(schedule.id);
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
