import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/profiles/:id/environment - Get environment overlay for a profile
 *
 * Returns the environment variables that should be set when launching
 * a session with this profile for proper agent isolation.
 */
export const GET = withAuth(async (_request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  const environment = await AgentProfileService.getProfileEnvironment(id, userId);
  if (!environment) {
    return errorResponse("Profile not found", 404);
  }

  return NextResponse.json(environment);
});
