import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getFolderSecretsConfig,
  updateFolderSecretsConfig,
  deleteFolderSecretsConfig,
  toggleFolderSecretsEnabled,
  SecretsServiceError,
} from "@/services/secrets-service";
import type { UpdateFolderSecretsConfigInput } from "@/types/secrets";

/**
 * GET /api/secrets/folders/[folderId]
 * Returns secrets configuration for a specific folder
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const config = await getFolderSecretsConfig(params!.folderId, userId);
  if (!config) {
    return errorResponse("No secrets configuration found", 404, "NOT_FOUND");
  }
  return NextResponse.json(config);
});

/**
 * PUT /api/secrets/folders/[folderId]
 * Creates or updates secrets configuration for a folder
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { provider, config, enabled } = body;

  if (!provider) {
    return errorResponse("Provider is required", 400, "MISSING_PROVIDER");
  }

  if (!config || typeof config !== "object") {
    return errorResponse("Config is required", 400, "MISSING_CONFIG");
  }

  const input: UpdateFolderSecretsConfigInput = {
    provider,
    config,
    enabled: enabled ?? true,
  };

  try {
    const result = await updateFolderSecretsConfig(params!.folderId, userId, input);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SecretsServiceError) {
      if (error.code === "INVALID_CONFIG") {
        return errorResponse(error.message, 400, error.code);
      }
      if (error.code === "PROVIDER_NOT_SUPPORTED") {
        return errorResponse(error.message, 400, error.code);
      }
    }
    throw error;
  }
});

/**
 * PATCH /api/secrets/folders/[folderId]
 * Toggles enabled state for folder secrets
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    return errorResponse("enabled must be a boolean", 400, "INVALID_ENABLED");
  }

  const result = await toggleFolderSecretsEnabled(params!.folderId, userId, enabled);
  if (!result) {
    return errorResponse("No secrets configuration found", 404, "NOT_FOUND");
  }

  return NextResponse.json(result);
});

/**
 * DELETE /api/secrets/folders/[folderId]
 * Removes secrets configuration for a folder
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await deleteFolderSecretsConfig(params!.folderId, userId);
  if (!deleted) {
    return errorResponse("No secrets configuration found", 404, "NOT_FOUND");
  }
  return NextResponse.json({ success: true });
});
