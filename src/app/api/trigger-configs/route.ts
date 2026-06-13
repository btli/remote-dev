/**
 * /api/trigger-configs (epic remote-dev-oyej.3)
 *   GET  — list the caller's trigger configs (optional ?projectId).
 *   POST — create a trigger config.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TriggerConfigService from "@/services/trigger-config-service";
import type { TriggerConfigInput } from "@/types/agent-run";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/trigger-configs");

export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const configs = await TriggerConfigService.listTriggerConfigs(
      userId,
      projectId,
    );
    return NextResponse.json({ configs });
  } catch (error) {
    log.error("Error listing trigger configs", { error: String(error) });
    return errorResponse("Failed to list trigger configs", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<TriggerConfigInput>(request);
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

    const config = await TriggerConfigService.createTriggerConfig(
      userId,
      input,
    );
    return NextResponse.json(config, { status: 201 });
  } catch (error) {
    if (error instanceof TriggerConfigService.TriggerConfigServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    log.error("Error creating trigger config", { error: String(error) });
    return errorResponse("Failed to create trigger config", 500);
  }
});
