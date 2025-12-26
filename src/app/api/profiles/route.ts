import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { AgentProvider } from "@/types/agent";

const VALID_PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini", "opencode", "all"];

/**
 * GET /api/profiles - Get all profiles for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [profiles, folderLinks] = await Promise.all([
    AgentProfileService.getProfiles(userId),
    AgentProfileService.getFolderProfileLinks(userId),
  ]);

  return NextResponse.json({ profiles, folderLinks });
});

/**
 * POST /api/profiles - Create a new agent profile
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const { name, description, provider, isDefault } = body;

  // Validate required fields
  if (!name || typeof name !== "string") {
    return errorResponse("Name is required", 400);
  }

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return errorResponse(
      `Provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400
    );
  }

  const profile = await AgentProfileService.createProfile(userId, {
    name,
    description: description ?? undefined,
    provider,
    isDefault: isDefault ?? false,
  });

  return NextResponse.json(profile, { status: 201 });
});
