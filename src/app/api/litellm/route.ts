import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as LiteLLMService from "@/services/litellm-service";
import { createLogger } from "@/lib/logger";

import type { UpdateLiteLLMConfigInput } from "@/types/litellm";

const log = createLogger("api/litellm");

/**
 * GET /api/litellm - Get user's LiteLLM config
 *
 * Returns the user's LiteLLM proxy configuration, or defaults if none exists.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const config = await LiteLLMService.getConfig(userId);
    return NextResponse.json({
      config: config ?? {
        id: null,
        userId,
        enabled: false,
        autoStart: false,
        port: 4000,
        createdAt: null,
        updatedAt: null,
      },
    });
  } catch (error) {
    log.error("Failed to get LiteLLM config", { error: String(error) });
    return errorResponse("Failed to get LiteLLM config", 500);
  }
});

/**
 * PATCH /api/litellm - Update LiteLLM config
 *
 * Creates or updates the user's LiteLLM proxy configuration.
 */
export const PATCH = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<UpdateLiteLLMConfigInput>(request);
    if ("error" in result) return result.error;
    const { enabled, autoStart, port } = result.data;

    // Validate port if provided
    if (port !== undefined) {
      if (typeof port !== "number" || port < 1024 || port > 65535) {
        return errorResponse(
          "Port must be a number between 1024 and 65535",
          400,
          "INVALID_PORT"
        );
      }
    }

    const config = await LiteLLMService.upsertConfig(userId, {
      enabled,
      autoStart,
      port,
    });
    return NextResponse.json({ config });
  } catch (error) {
    log.error("Failed to update LiteLLM config", { error: String(error) });
    return errorResponse("Failed to update LiteLLM config", 500);
  }
});
