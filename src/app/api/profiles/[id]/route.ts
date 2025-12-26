import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { AgentProvider } from "@/types/agent";

const VALID_PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini", "opencode", "all"];

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/profiles/:id - Get a specific profile
 */
export const GET = withAuth(async (_request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  const profile = await AgentProfileService.getProfile(id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  return NextResponse.json(profile);
});

/**
 * PATCH /api/profiles/:id - Update a profile
 */
export const PATCH = withAuth(async (request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const { name, description, provider, isDefault } = body;

  // Validate provider if provided
  if (provider !== undefined && !VALID_PROVIDERS.includes(provider)) {
    return errorResponse(
      `Provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400
    );
  }

  const updated = await AgentProfileService.updateProfile(id, userId, {
    name: name ?? undefined,
    description: description ?? undefined,
    provider: provider ?? undefined,
    isDefault: isDefault ?? undefined,
  });

  if (!updated) {
    return errorResponse("Profile not found", 404);
  }

  return NextResponse.json(updated);
});

/**
 * DELETE /api/profiles/:id - Delete a profile
 */
export const DELETE = withAuth(async (_request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  const deleted = await AgentProfileService.deleteProfile(id, userId);
  if (!deleted) {
    return errorResponse("Profile not found", 404);
  }

  return NextResponse.json({ success: true });
});
