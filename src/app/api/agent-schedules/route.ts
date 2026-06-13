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
