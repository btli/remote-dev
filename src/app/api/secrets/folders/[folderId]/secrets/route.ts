import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  fetchSecretsForFolder,
  SecretsServiceError,
} from "@/services/secrets-service";

/**
 * GET /api/secrets/folders/[folderId]/secrets
 *
 * Fetches the actual secret values for a folder from the configured provider.
 * Returns a Record<string, string> of secret key-value pairs.
 *
 * This endpoint is called when a terminal session is created to inject
 * secrets as environment variables.
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const folderId = params!.folderId;

  try {
    const secrets = await fetchSecretsForFolder(folderId, userId);

    if (!secrets) {
      // No secrets configured or provider disabled
      return NextResponse.json({});
    }

    // Return only the secrets key-value pairs, not the full FetchSecretsResult
    return NextResponse.json(secrets.secrets);
  } catch (error) {
    if (error instanceof SecretsServiceError) {
      if (error.code === "NO_CONFIG") {
        // Return empty object for folders without config
        return NextResponse.json({});
      }
      if (error.code === "PROVIDER_DISABLED") {
        // Return empty object if provider is disabled
        return NextResponse.json({});
      }
      // Other secrets errors
      return errorResponse(error.message, 500, error.code);
    }

    console.error("Error fetching secrets:", error);
    return errorResponse("Failed to fetch secrets", 500);
  }
});
