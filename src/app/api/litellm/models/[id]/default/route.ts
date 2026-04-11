import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as LiteLLMService from "@/services/litellm-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/litellm/models/default");

/**
 * POST /api/litellm/models/:id/default - Set a model as the default
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    const modelId = params?.id;
    if (!modelId) {
      return errorResponse("Model ID is required", 400, "ID_REQUIRED");
    }

    await LiteLLMService.setDefaultModel(userId, modelId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = String(error);
    if (msg.includes("not found")) {
      return errorResponse("Model not found", 404, "NOT_FOUND");
    }
    log.error("Failed to set default LiteLLM model", { error: msg, modelId: params?.id });
    return errorResponse("Failed to set default LiteLLM model", 500);
  }
});
