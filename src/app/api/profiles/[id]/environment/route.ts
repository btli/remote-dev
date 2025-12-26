import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";

/**
 * GET /api/profiles/:id/environment - Get environment overlay for a profile
 *
 * Returns the environment variables that should be set when launching
 * a session with this profile for proper agent isolation.
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const environment = await AgentProfileService.getProfileEnvironment(params!.id, userId);
  if (!environment) {
    return errorResponse("Profile not found", 404);
  }

  return NextResponse.json(environment);
});
