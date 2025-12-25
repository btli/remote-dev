import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { validateProviderConfig } from "@/services/secrets-service";

/**
 * POST /api/secrets/validate
 * Validates provider configuration and credentials
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { provider, config } = body;

  if (!provider) {
    return errorResponse("Provider is required", 400, "MISSING_PROVIDER");
  }

  if (!config || typeof config !== "object") {
    return errorResponse("Config is required", 400, "MISSING_CONFIG");
  }

  const result = await validateProviderConfig(provider, config);
  return NextResponse.json(result);
});
