/**
 * /api/agent-schedules (epic remote-dev-oyej.1)
 *   GET  — list the caller's agent schedules (optional ?projectId filter).
 *   POST — create a scheduled REAL agent run + notify the terminal server's
 *          agent scheduler (fire-and-forget).
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentScheduleService from "@/services/agent-schedule-service";
import { notifyAgentScheduleCreated } from "@/lib/scheduler-client";
import type { AgentScheduleInput } from "@/types/agent-run";
import { createLogger } from "@/lib/logger";
import {
  isValidIntervalSeconds,
  isValidTimezone,
} from "@/lib/schedule-validation";

const log = createLogger("api/agent-schedules");

export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const schedules = await AgentScheduleService.listAgentSchedules(
      userId,
      projectId,
    );
    return NextResponse.json({ schedules });
  } catch (error) {
    log.error("Error listing agent schedules", { error: String(error) });
    return errorResponse("Failed to list agent schedules", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<AgentScheduleInput>(request);
    if ("error" in result) return result.error;
    const input = result.data;

    if (!input.projectId) {
      return errorResponse("projectId is required", 400, "PROJECT_ID_REQUIRED");
    }
    // profileId is optional: a string pins the Claude profile, null/absent
    // auto-selects. Reject only a clearly malformed value (matches /api/agent-runs).
    if (
      input.profileId !== undefined &&
      input.profileId !== null &&
      typeof input.profileId !== "string"
    ) {
      return errorResponse("profileId must be a string or null", 400, "INVALID_PROFILE_ID");
    }

    const scheduleType = input.scheduleType || "recurring";
    if (!["one-time", "recurring", "interval"].includes(scheduleType)) {
      return errorResponse(
        "Invalid schedule type",
        400,
        "INVALID_SCHEDULE_TYPE",
      );
    }
    const timezone =
      input.timezone === undefined ? "America/Los_Angeles" : input.timezone;
    if (!isValidTimezone(timezone)) {
      return errorResponse("Invalid timezone", 400, "INVALID_TIMEZONE");
    }
    if (scheduleType === "interval") {
      if (!isValidIntervalSeconds(input.intervalSeconds)) {
        return errorResponse(
          "Interval must be between 1 minute and 30 days",
          400,
          "INVALID_INTERVAL_SECONDS",
        );
      }
      if (!input.anchorAt) {
        return errorResponse(
          "Anchor time is required for interval schedules",
          400,
          "ANCHOR_AT_REQUIRED",
        );
      }
      if (isNaN(new Date(input.anchorAt).getTime())) {
        return errorResponse(
          "Invalid anchor time format",
          400,
          "INVALID_ANCHOR_AT",
        );
      }
    }

    const schedule = await AgentScheduleService.createAgentSchedule(
      userId,
      input,
    );

    if (schedule.enabled) {
      notifyAgentScheduleCreated(schedule.id).catch((err) =>
        log.warn("Failed to notify agent scheduler of new schedule", {
          error: String(err),
        }),
      );
    }

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    if (error instanceof AgentScheduleService.AgentScheduleServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    log.error("Error creating agent schedule", { error: String(error) });
    return errorResponse("Failed to create agent schedule", 500);
  }
});
