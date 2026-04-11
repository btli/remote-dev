import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as LiteLLMService from "@/services/litellm-service";
import { createLogger } from "@/lib/logger";

import type { AddLiteLLMModelInput } from "@/types/litellm";

const log = createLogger("api/litellm/models");

/**
 * GET /api/litellm/models - List user's LiteLLM models
 *
 * Returns all model configurations for the LiteLLM proxy.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const models = await LiteLLMService.listModels(userId);
    return NextResponse.json({ models });
  } catch (error) {
    log.error("Failed to list LiteLLM models", { error: String(error) });
    return errorResponse("Failed to list LiteLLM models", 500);
  }
});

/**
 * POST /api/litellm/models - Add a new model to LiteLLM
 *
 * Body: { modelName: string, provider: string, litellmModel: string, apiBase?: string, apiKey?: string, extraHeaders?: string, priority?: number, isDefault?: boolean }
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<AddLiteLLMModelInput>(request);
    if ("error" in result) return result.error;
    const input = result.data;

    if (!input.modelName || typeof input.modelName !== "string") {
      return errorResponse("Model name is required", 400, "MODEL_NAME_REQUIRED");
    }

    if (!input.provider || typeof input.provider !== "string") {
      return errorResponse("Provider is required", 400, "PROVIDER_REQUIRED");
    }

    if (!input.litellmModel || typeof input.litellmModel !== "string") {
      return errorResponse("LiteLLM model identifier is required", 400, "LITELLM_MODEL_REQUIRED");
    }

    if (input.priority !== undefined && (typeof input.priority !== "number" || input.priority < 0)) {
      return errorResponse("Priority must be a non-negative number", 400, "INVALID_PRIORITY");
    }

    const created = await LiteLLMService.addModel(userId, input);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    log.error("Failed to add LiteLLM model", { error: String(error) });
    return errorResponse("Failed to add LiteLLM model", 500);
  }
});
