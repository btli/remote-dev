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

    const updated = await AgentScheduleService.updateAgentSchedule(
      userId,
      id,
      result.data,
    );
    if (!updated) return errorResponse("Schedule not found", 404, "NOT_FOUND");

    notifyAgentScheduleUpdated(id).catch((err) =>
      log.warn("Failed to notify agent scheduler of update", {
        error: String(err),
      }),
    );
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
