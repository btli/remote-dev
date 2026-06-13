/**
 * GET /api/profiles/select?projectId= - recommended profile for a project.
 * [remote-dev-wb0q]
 *
 * Read-only wizard pre-fill: runs SelectProfileUseCase (primary → fallback
 * pool with rotation) and returns `{ profileId, wasAutoSelected }`. Creates
 * nothing. `profileId` is null when nothing is configured for the project
 * (caller proceeds with no profile = legacy behavior).
 *
 * The use-case + policy read `project_profile_link` and the inherited
 * `nodePreferences.claudeProfilePoolId` for the project; we additionally verify
 * the resolved profile belongs to the caller before returning it (defense in
 * depth — a project-link should already be the user's, but never echo a
 * foreign profileId).
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { selectProfileUseCase } from "@/infrastructure/container";
import * as AgentProfileService from "@/services/agent-profile-service";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (request, { userId }) => {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return errorResponse("projectId is required", 400);

  const result = await selectProfileUseCase.execute({ projectId, userId });

  // Defense in depth: never echo a profileId the caller doesn't own.
  if (result.profileId) {
    const profile = await AgentProfileService.getProfile(
      result.profileId,
      userId
    );
    if (!profile) {
      return NextResponse.json({ profileId: null, wasAutoSelected: false });
    }
  }

  return NextResponse.json({
    profileId: result.profileId,
    wasAutoSelected: result.wasAutoSelected,
  });
});
