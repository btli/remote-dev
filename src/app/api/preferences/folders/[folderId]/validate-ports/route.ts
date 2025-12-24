import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { validatePorts } from "@/services/port-registry-service";
import type { EnvironmentVariables } from "@/types/environment";
import { validateEnvVarKey, validateEnvVarValue } from "@/types/environment";

/**
 * Validate environment variables input
 */
function validateEnvironmentVars(
  envVars: unknown
): { valid: true; value: EnvironmentVariables | null } | { valid: false; error: string } {
  if (envVars === null || envVars === undefined) {
    return { valid: true, value: null };
  }

  if (typeof envVars !== "object" || Array.isArray(envVars)) {
    return { valid: false, error: "environmentVars must be an object or null" };
  }

  const validated: EnvironmentVariables = {};

  for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
    const keyError = validateEnvVarKey(key);
    if (keyError) {
      return { valid: false, error: `Invalid key "${key}": ${keyError}` };
    }

    if (typeof value !== "string") {
      return { valid: false, error: `Value for "${key}" must be a string` };
    }

    const valueError = validateEnvVarValue(value);
    if (valueError) {
      return { valid: false, error: `Invalid value for "${key}": ${valueError}` };
    }

    validated[key] = value;
  }

  return { valid: true, value: Object.keys(validated).length > 0 ? validated : null };
}

/**
 * POST /api/preferences/folders/[folderId]/validate-ports
 *
 * Validates environment variables for port conflicts without saving.
 * Useful for real-time feedback in the UI.
 *
 * Request body:
 * {
 *   "environmentVars": { "PORT": "3000", "DB_PORT": "5432" }
 * }
 *
 * Response:
 * {
 *   "conflicts": [...],
 *   "hasConflicts": true
 * }
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const body = await request.json();

  // Validate environment variables
  const validation = validateEnvironmentVars(body.environmentVars);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  try {
    const result = await validatePorts(
      params!.folderId,
      userId,
      validation.value
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      return errorResponse(error.message, 500);
    }
    throw error;
  }
});
