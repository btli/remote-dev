import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as CcflareService from "@/services/ccflare-service";
import { createLogger } from "@/lib/logger";

import type { AddCcflareKeyInput } from "@/types/ccflare";

const log = createLogger("api/ccflare/keys");

/**
 * GET /api/ccflare/keys - List user's ccflare API keys
 *
 * Returns all Anthropic API keys configured for the ccflare proxy.
 * Note: Actual key values are never returned after creation.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const keys = await CcflareService.listApiKeys(userId);
    return NextResponse.json({ keys });
  } catch (error) {
    log.error("Failed to list ccflare keys", { error: String(error) });
    return errorResponse("Failed to list ccflare keys", 500);
  }
});

/**
 * POST /api/ccflare/keys - Add a new Anthropic API key for ccflare
 *
 * Body: { name: string, key: string, priority?: number }
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<AddCcflareKeyInput>(request);
    if ("error" in result) return result.error;
    const { name, key, baseUrl, priority } = result.data;

    if (!name || typeof name !== "string") {
      return errorResponse("Key name is required", 400, "NAME_REQUIRED");
    }

    if (!key || typeof key !== "string") {
      return errorResponse("API key value is required", 400, "KEY_REQUIRED");
    }

    if (baseUrl !== undefined && baseUrl !== null && typeof baseUrl === "string" && baseUrl.trim()) {
      try {
        new URL(baseUrl);
      } catch {
        return errorResponse("Invalid base URL", 400, "INVALID_BASE_URL");
      }
    }

    if (priority !== undefined && (typeof priority !== "number" || priority < 0)) {
      return errorResponse("Priority must be a non-negative number", 400, "INVALID_PRIORITY");
    }

    const created = await CcflareService.addApiKey(userId, { name, key, baseUrl, priority });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    log.error("Failed to add ccflare key", { error: String(error) });
    return errorResponse("Failed to add ccflare key", 500);
  }
});
