/**
 * /api/trigger-configs/[id] (epic remote-dev-oyej.3)
 *   GET    — fetch one config (owner-scoped).
 *   PATCH  — update.
 *   DELETE — delete.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TriggerConfigService from "@/services/trigger-config-service";
import type { TriggerConfigUpdate } from "@/types/agent-run";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/trigger-configs");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const config = await TriggerConfigService.getTriggerConfig(userId, id);
  if (!config) return errorResponse("Trigger config not found", 404, "NOT_FOUND");
  return NextResponse.json(config);
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const result = await parseJsonBody<TriggerConfigUpdate>(request);
    if ("error" in result) return result.error;

    const updated = await TriggerConfigService.updateTriggerConfig(
      userId,
      id,
      result.data,
    );
    if (!updated)
      return errorResponse("Trigger config not found", 404, "NOT_FOUND");
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof TriggerConfigService.TriggerConfigServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    log.error("Error updating trigger config", { error: String(error) });
    return errorResponse("Failed to update trigger config", 500);
  }
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const ok = await TriggerConfigService.deleteTriggerConfig(userId, id);
  if (!ok) return errorResponse("Trigger config not found", 404, "NOT_FOUND");
  return NextResponse.json({ success: true });
});
