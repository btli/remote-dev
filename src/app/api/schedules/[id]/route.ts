import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";
import { schedulerOrchestrator } from "@/services/scheduler-orchestrator";
import type { UpdateScheduleInput, ScheduleCommandInput } from "@/types/schedule";

/**
 * GET /api/schedules/:id - Get schedule details with commands
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const scheduleId = params?.id;
    if (!scheduleId) {
      return errorResponse("Schedule ID is required", 400, "ID_REQUIRED");
    }

    const schedule = await ScheduleService.getScheduleWithCommands(
      scheduleId,
      userId
    );

    if (!schedule) {
      return errorResponse("Schedule not found", 404, "SCHEDULE_NOT_FOUND");
    }

    return NextResponse.json(schedule);
  } catch (error) {
    console.error("Error getting schedule:", error);
    return errorResponse("Failed to get schedule", 500);
  }
});

/**
 * PATCH /api/schedules/:id - Update schedule
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  try {
    const scheduleId = params?.id;
    if (!scheduleId) {
      return errorResponse("Schedule ID is required", 400, "ID_REQUIRED");
    }

    const result = await parseJsonBody<
      UpdateScheduleInput & { commands?: ScheduleCommandInput[] }
    >(request);
    if ("error" in result) return result.error;
    const { commands, ...updates } = result.data;

    // Update schedule metadata if provided
    if (Object.keys(updates).length > 0) {
      await ScheduleService.updateSchedule(scheduleId, userId, updates);
    } else {
      const existing = await ScheduleService.getSchedule(scheduleId, userId);
      if (!existing) {
        return errorResponse("Schedule not found", 404, "SCHEDULE_NOT_FOUND");
      }
    }

    // Update commands if provided
    if (commands && commands.length > 0) {
      await ScheduleService.updateScheduleCommands(scheduleId, userId, commands);
    }

    // Notify orchestrator of changes
    await schedulerOrchestrator.updateJob(scheduleId);

    // Return updated schedule with commands
    const updated = await ScheduleService.getScheduleWithCommands(scheduleId, userId);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating schedule:", error);
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SCHEDULE_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to update schedule", 500);
  }
});

/**
 * DELETE /api/schedules/:id - Delete schedule
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  try {
    const scheduleId = params?.id;
    if (!scheduleId) {
      return errorResponse("Schedule ID is required", 400, "ID_REQUIRED");
    }

    // Remove from orchestrator first
    schedulerOrchestrator.removeJob(scheduleId);

    // Delete from database
    await ScheduleService.deleteSchedule(scheduleId, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting schedule:", error);
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SCHEDULE_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to delete schedule", 500);
  }
});
