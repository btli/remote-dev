import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as LiteLLMService from "@/services/litellm-service";
import { createLogger } from "@/lib/logger";

import type { AddLiteLLMModelInput } from "@/types/litellm";

const log = createLogger("api/litellm/models");

/**
 * DELETE /api/litellm/models/:id - Remove a LiteLLM model
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const modelId = params?.id;
    if (!modelId) {
      return errorResponse("Model ID is required", 400, "ID_REQUIRED");
    }

    const deleted = await LiteLLMService.removeModel(userId, modelId);
    if (!deleted) {
      return errorResponse("Model not found", 404, "NOT_FOUND");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to remove LiteLLM model", { error: String(error), modelId: params?.id });
    return errorResponse("Failed to remove LiteLLM model", 500);
  }
});

/**
 * PATCH /api/litellm/models/:id - Toggle pause state for a LiteLLM model
 */
export const PATCH = withAuth(async (_request, { userId, params }) => {
  try {
    const modelId = params?.id;
    if (!modelId) {
      return errorResponse("Model ID is required", 400, "ID_REQUIRED");
    }

    const updated = await LiteLLMService.toggleModelPause(userId, modelId);
    return NextResponse.json(updated);
  } catch (error) {
    const msg = String(error);
    if (msg.includes("not found")) {
      return errorResponse("Model not found", 404, "NOT_FOUND");
    }
    log.error("Failed to toggle LiteLLM model pause", { error: msg, modelId: params?.id });
    return errorResponse("Failed to toggle LiteLLM model pause", 500);
  }
});

/**
 * PUT /api/litellm/models/:id - Update a LiteLLM model
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  try {
    const modelId = params?.id;
    if (!modelId) {
      return errorResponse("Model ID is required", 400, "ID_REQUIRED");
    }

    const result = await parseJsonBody<Partial<AddLiteLLMModelInput>>(request);
    if ("error" in result) return result.error;
    const input = result.data;

    if (input.priority !== undefined && (typeof input.priority !== "number" || input.priority < 0)) {
      return errorResponse("Priority must be a non-negative number", 400, "INVALID_PRIORITY");
    }

    const updated = await LiteLLMService.updateModel(userId, modelId, input);
    return NextResponse.json(updated);
  } catch (error) {
    const msg = String(error);
    if (msg.includes("not found")) {
      return errorResponse("Model not found", 404, "NOT_FOUND");
    }
    log.error("Failed to update LiteLLM model", { error: msg, modelId: params?.id });
    return errorResponse("Failed to update LiteLLM model", 500);
  }
});
