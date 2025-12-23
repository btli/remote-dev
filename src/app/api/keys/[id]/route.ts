import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as ApiKeyService from "@/services/api-key-service";

/**
 * GET /api/keys/:id - Get a single API key by ID
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  try {
    const keyId = params?.id;
    if (!keyId) {
      return errorResponse("API key ID is required", 400, "ID_REQUIRED");
    }

    const key = await ApiKeyService.getApiKey(keyId, userId);
    if (!key) {
      return errorResponse("API key not found", 404, "KEY_NOT_FOUND");
    }

    return NextResponse.json({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error getting API key:", error);
    return errorResponse("Failed to get API key", 500);
  }
});

/**
 * DELETE /api/keys/:id - Revoke an API key
 *
 * Permanently deletes the API key. This cannot be undone.
 * Any clients using this key will immediately lose access.
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const keyId = params?.id;
    if (!keyId) {
      return errorResponse("API key ID is required", 400, "ID_REQUIRED");
    }

    await ApiKeyService.deleteApiKey(keyId, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting API key:", error);

    if (error instanceof ApiKeyService.ApiKeyServiceError) {
      if (error.code === "KEY_NOT_FOUND") {
        return errorResponse("API key not found", 404, "KEY_NOT_FOUND");
      }
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to delete API key", 500);
  }
});
