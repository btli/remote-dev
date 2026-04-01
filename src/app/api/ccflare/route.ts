import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as CcflareService from "@/services/ccflare-service";
import { createLogger } from "@/lib/logger";

import type { UpdateCcflareConfigInput } from "@/types/ccflare";

const log = createLogger("api/ccflare");

/**
 * GET /api/ccflare - Get user's ccflare config
 *
 * Returns the user's ccflare proxy configuration, or defaults if none exists.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const config = await CcflareService.getConfig(userId);
    return NextResponse.json({
      config: config ?? {
        id: null,
        userId,
        enabled: false,
        autoStart: false,
        port: 8787,
        createdAt: null,
        updatedAt: null,
      },
    });
  } catch (error) {
    log.error("Failed to get ccflare config", { error: String(error) });
    return errorResponse("Failed to get ccflare config", 500);
  }
});

/**
 * PATCH /api/ccflare - Update ccflare config
 *
 * Creates or updates the user's ccflare proxy configuration.
 */
export const PATCH = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<UpdateCcflareConfigInput>(request);
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

    const config = await CcflareService.upsertConfig(userId, {
      enabled,
      autoStart,
      port,
    });
    return NextResponse.json({ config });
  } catch (error) {
    log.error("Failed to update ccflare config", { error: String(error) });
    return errorResponse("Failed to update ccflare config", 500);
  }
});
