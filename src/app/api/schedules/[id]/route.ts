import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ScheduleService from "@/services/schedule-service";
import { notifyScheduleUpdated, notifyScheduleDeleted } from "@/lib/scheduler-client";
import type { UpdateScheduleInput, ScheduleCommandInput } from "@/types/schedule";
import { createLogger } from "@/lib/logger";
import {
  isValidTimezone,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
} from "@/lib/schedule-validation";

const log = createLogger("api/schedules");

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
    log.error("Error getting schedule", { error: String(error) });
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

    if (
      updates.scheduleType !== undefined &&
      !["one-time", "recurring", "interval"].includes(updates.scheduleType)
    ) {
      return errorResponse("Invalid schedule type", 400, "INVALID_SCHEDULE_TYPE");
    }
    if (
      updates.intervalSeconds !== undefined &&
      updates.intervalSeconds !== null &&
      (!Number.isInteger(updates.intervalSeconds) ||
        updates.intervalSeconds < MIN_INTERVAL_SECONDS ||
        updates.intervalSeconds > MAX_INTERVAL_SECONDS)
    ) {
      return errorResponse(
        "Interval must be between 1 minute and 30 days",
        400,
        "INVALID_INTERVAL_SECONDS"
      );
    }
    if (
      updates.timezone !== undefined &&
      !isValidTimezone(updates.timezone)
    ) {
      return errorResponse("Invalid timezone", 400, "INVALID_TIMEZONE");
    }
    if (
      updates.anchorAt !== undefined &&
      updates.anchorAt !== null &&
      isNaN(new Date(updates.anchorAt).getTime())
    ) {
      return errorResponse(
        "Invalid anchor time format",
        400,
        "INVALID_ANCHOR_AT"
      );
    }
    // Update schedule metadata if provided
    // If no updates, still validate ownership/existence to prevent blind command updates
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

    // Notify terminal server's scheduler of changes
    // Fire-and-forget - schedule is already saved in database
    notifyScheduleUpdated(scheduleId).catch((err) =>
      log.warn("Failed to notify scheduler of schedule update", { error: String(err) })
    );

    // Success-path audit log: which fields changed and by whom, so state
    // transitions (especially enabled=false) are never traceless.
    log.info("Schedule updated", {
      scheduleId,
      userId,
      changedFields: Object.keys(updates),
      commandsUpdated: Boolean(commands && commands.length > 0),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
    });

    // Return updated schedule with commands
    const updated = await ScheduleService.getScheduleWithCommands(scheduleId, userId);
    return NextResponse.json(updated);
  } catch (error) {
    log.error("Error updating schedule", { error: String(error) });
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

    // Delete from database first
    await ScheduleService.deleteSchedule(scheduleId, userId);

    // Notify terminal server's scheduler to remove the job
    // Fire-and-forget - if it fails, the job will be orphaned but harmless
    notifyScheduleDeleted(scheduleId).catch((err) =>
      log.warn("Failed to notify scheduler of schedule deletion", { error: String(err) })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Error deleting schedule", { error: String(error) });
    if (error instanceof ScheduleService.ScheduleServiceError) {
      const status = error.code === "SCHEDULE_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    return errorResponse("Failed to delete schedule", 500);
  }
});
