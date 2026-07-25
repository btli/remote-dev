/**
 * /api/agent-schedules/[id] (epic remote-dev-oyej.1)
 *   GET    — fetch one schedule (owner-scoped).
 *   PATCH  — update + notify the agent scheduler.
 *   DELETE — delete + notify the agent scheduler.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentScheduleService from "@/services/agent-schedule-service";
import {
  notifyAgentScheduleUpdated,
  notifyAgentScheduleDeleted,
} from "@/lib/scheduler-client";
import type { AgentScheduleUpdate } from "@/types/agent-run";
import { createLogger } from "@/lib/logger";
import {
  isValidIntervalSeconds,
  isValidTimezone,
} from "@/lib/schedule-validation";

const log = createLogger("api/agent-schedules");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const schedule = await AgentScheduleService.getAgentSchedule(userId, id);
  if (!schedule) return errorResponse("Schedule not found", 404, "NOT_FOUND");
  return NextResponse.json(schedule);
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const result = await parseJsonBody<AgentScheduleUpdate>(request);
    if ("error" in result) return result.error;
    const updates = result.data;

    if (
      updates.scheduleType !== undefined &&
      !["one-time", "recurring", "interval"].includes(updates.scheduleType)
    ) {
      return errorResponse(
        "Invalid schedule type",
        400,
        "INVALID_SCHEDULE_TYPE",
      );
    }
    if (
      updates.intervalSeconds !== undefined &&
      updates.intervalSeconds !== null &&
      !isValidIntervalSeconds(updates.intervalSeconds)
    ) {
      return errorResponse(
        "Interval must be between 1 minute and 30 days",
        400,
        "INVALID_INTERVAL_SECONDS",
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
        "INVALID_ANCHOR_AT",
      );
    }

    const updated = await AgentScheduleService.updateAgentSchedule(
      userId,
      id,
      updates,
    );
    if (!updated) return errorResponse("Schedule not found", 404, "NOT_FOUND");

    notifyAgentScheduleUpdated(id).catch((err) =>
      log.warn("Failed to notify agent scheduler of update", {
        error: String(err),
      }),
    );
    log.info("Agent schedule updated", {
      scheduleId: id,
      userId,
      changedFields: Object.keys(updates),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AgentScheduleService.AgentScheduleServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    log.error("Error updating agent schedule", { error: String(error) });
    return errorResponse("Failed to update agent schedule", 500);
  }
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const ok = await AgentScheduleService.deleteAgentSchedule(userId, id);
  if (!ok) return errorResponse("Schedule not found", 404, "NOT_FOUND");

  notifyAgentScheduleDeleted(id).catch((err) =>
    log.warn("Failed to notify agent scheduler of delete", {
      error: String(err),
    }),
  );
  return NextResponse.json({ success: true });
});
