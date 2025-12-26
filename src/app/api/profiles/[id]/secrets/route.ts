import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { UpdateProfileSecretsConfigInput } from "@/types/agent";

/**
 * GET /api/profiles/:id/secrets - Get secrets configuration for a profile
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const secretsConfig = await AgentProfileService.getProfileSecretsConfig(params!.id, userId);
  return NextResponse.json(secretsConfig ?? null);
});

/**
 * PUT /api/profiles/:id/secrets - Create/update secrets configuration for a profile
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const result = await parseJsonBody<UpdateProfileSecretsConfigInput>(request);
  if ("error" in result) {
    return result.error;
  }

  const { provider, config, enabled } = result.data;

  // Validate required fields
  if (!provider) {
    return errorResponse("provider is required", 400);
  }
  if (!config || typeof config !== "object") {
    return errorResponse("config is required", 400);
  }

  try {
    const secretsConfig = await AgentProfileService.updateProfileSecretsConfig(
      params!.id,
      userId,
      { provider, config, enabled }
    );
    return NextResponse.json(secretsConfig);
  } catch (error) {
    if (error instanceof AgentProfileService.AgentProfileServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }
});

/**
 * PATCH /api/profiles/:id/secrets - Toggle secrets enabled state
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const result = await parseJsonBody<{ enabled: boolean }>(request);
  if ("error" in result) {
    return result.error;
  }

  const { enabled } = result.data;
  if (typeof enabled !== "boolean") {
    return errorResponse("enabled must be a boolean", 400);
  }

  const secretsConfig = await AgentProfileService.toggleProfileSecretsEnabled(
    params!.id,
    userId,
    enabled
  );

  if (!secretsConfig) {
    return errorResponse("No secrets configuration found for this profile", 404);
  }

  return NextResponse.json(secretsConfig);
});

/**
 * DELETE /api/profiles/:id/secrets - Delete secrets configuration for a profile
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const deleted = await AgentProfileService.deleteProfileSecretsConfig(params!.id, userId);
  if (!deleted) {
    return errorResponse("No secrets configuration found for this profile", 404);
  }

  return NextResponse.json({ success: true });
});
