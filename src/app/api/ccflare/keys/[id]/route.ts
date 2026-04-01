import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as CcflareService from "@/services/ccflare-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ccflare/keys");

/**
 * DELETE /api/ccflare/keys/:id - Remove a ccflare API key
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const keyId = params?.id;
    if (!keyId) {
      return errorResponse("Key ID is required", 400, "ID_REQUIRED");
    }

    const deleted = await CcflareService.removeApiKey(userId, keyId);
    if (!deleted) {
      return errorResponse("API key not found", 404, "NOT_FOUND");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to remove ccflare key", { error: String(error), keyId: params?.id });
    return errorResponse("Failed to remove ccflare key", 500);
  }
});

/**
 * PATCH /api/ccflare/keys/:id - Toggle pause state for a ccflare API key
 */
export const PATCH = withAuth(async (_request, { userId, params }) => {
  try {
    const keyId = params?.id;
    if (!keyId) {
      return errorResponse("Key ID is required", 400, "ID_REQUIRED");
    }

    const updated = await CcflareService.toggleApiKeyPause(userId, keyId);
    return NextResponse.json(updated);
  } catch (error) {
    const msg = String(error);
    if (msg.includes("not found")) {
      return errorResponse("API key not found", 404, "NOT_FOUND");
    }
    log.error("Failed to toggle ccflare key pause", { error: msg, keyId: params?.id });
    return errorResponse("Failed to toggle ccflare key pause", 500);
  }
});
