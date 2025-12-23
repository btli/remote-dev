import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ApiKeyService from "@/services/api-key-service";

const MAX_KEYS_PER_USER = 10;

/**
 * GET /api/keys - List user's API keys
 *
 * Returns all API keys for the authenticated user.
 * Note: The actual key value is never returned after creation.
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const keys = await ApiKeyService.listApiKeys(userId);
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Error listing API keys:", error);
    return errorResponse("Failed to list API keys", 500);
  }
});

/**
 * POST /api/keys - Create a new API key
 *
 * Returns the full API key value. This is the ONLY time the key will be visible.
 * The key should be stored securely by the client.
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      name: string;
      expiresInDays?: number;
    }>(request);
    if ("error" in result) return result.error;
    const { name, expiresInDays } = result.data;

    // Validate name
    if (!name || typeof name !== "string") {
      return errorResponse("API key name is required", 400, "NAME_REQUIRED");
    }

    // Check key limit
    const currentCount = await ApiKeyService.countApiKeys(userId);
    if (currentCount >= MAX_KEYS_PER_USER) {
      return errorResponse(
        `Maximum of ${MAX_KEYS_PER_USER} API keys allowed`,
        400,
        "KEY_LIMIT_REACHED"
      );
    }

    // Calculate expiration if provided
    let expiresAt: Date | undefined;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const created = await ApiKeyService.createApiKey(userId, name, expiresAt);

    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        key: created.key, // Full key - only returned once!
        keyPrefix: created.keyPrefix,
        createdAt: created.createdAt.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating API key:", error);

    if (error instanceof ApiKeyService.ApiKeyServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to create API key", 500);
  }
});
