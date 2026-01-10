import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getFolderPreferences,
  updateFolderPreferences,
  deleteFolderPreferences,
} from "@/services/preferences-service";
import type { EnvironmentVariables } from "@/types/environment";
import { validateEnvVarKey, validateEnvVarValue } from "@/types/environment";

/**
 * GET /api/preferences/folders/[folderId]
 * Returns folder-specific preference overrides
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const prefs = await getFolderPreferences(params!.folderId, userId);
  if (!prefs) {
    return errorResponse("Not found", 404);
  }
  return NextResponse.json(prefs);
});

/**
 * Validate environment variables input
 */
function validateEnvironmentVars(
  envVars: unknown
): { valid: true; value: EnvironmentVariables | null } | { valid: false; error: string } {
  // null is allowed (clear all env vars)
  if (envVars === null) {
    return { valid: true, value: null };
  }

  // Must be an object
  if (typeof envVars !== "object" || Array.isArray(envVars)) {
    return { valid: false, error: "environmentVars must be an object or null" };
  }

  const validated: EnvironmentVariables = {};

  for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
    // Validate key
    const keyError = validateEnvVarKey(key);
    if (keyError) {
      return { valid: false, error: `Invalid key "${key}": ${keyError}` };
    }

    // Value must be a string
    if (typeof value !== "string") {
      return { valid: false, error: `Value for "${key}" must be a string` };
    }

    // Validate value
    const valueError = validateEnvVarValue(value);
    if (valueError) {
      return { valid: false, error: `Invalid value for "${key}": ${valueError}` };
    }

    validated[key] = value;
  }

  return { valid: true, value: Object.keys(validated).length > 0 ? validated : null };
}

/**
 * PUT /api/preferences/folders/[folderId]
 * Creates or updates folder-specific preference overrides.
 *
 * When environmentVars are included, the response includes port validation
 * with any detected conflicts and suggested alternatives.
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const updates = await request.json();

  // Validate updates
  const allowedFields = [
    "defaultWorkingDirectory",
    "defaultShell",
    "startupCommand",
    "theme",
    "fontSize",
    "fontFamily",
    "githubRepoId",
    "localRepoPath",
    "environmentVars",
    "orchestratorFirstMode",
  ];

  const filteredUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      // Special validation for environmentVars
      if (key === "environmentVars") {
        const validation = validateEnvironmentVars(value);
        if (!validation.valid) {
          return errorResponse(validation.error, 400);
        }
        filteredUpdates[key] = validation.value;
      } else {
        filteredUpdates[key] = value;
      }
    }
  }

  try {
    const result = await updateFolderPreferences(
      params!.folderId,
      userId,
      filteredUpdates
    );

    // Return preferences with port validation if env vars were updated
    return NextResponse.json({
      ...result.preferences,
      portValidation: result.portValidation,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Folder not found") {
      return errorResponse("Folder not found", 404);
    }
    throw error;
  }
});

/**
 * DELETE /api/preferences/folders/[folderId]
 * Removes folder-specific preference overrides (reverts to user defaults)
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await deleteFolderPreferences(params!.folderId, userId);
  if (!deleted) {
    return errorResponse("Not found", 404);
  }
  return NextResponse.json({ success: true });
});
