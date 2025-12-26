import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";

/**
 * PUT /api/profiles/folders/:folderId - Link folder to a profile
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const folderId = params!.folderId;

  const result = await parseJsonBody<{ profileId: string }>(request);
  if ("error" in result) {
    return result.error;
  }

  const { profileId } = result.data;

  if (!profileId || typeof profileId !== "string") {
    return errorResponse("profileId is required", 400);
  }

  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  await AgentProfileService.linkFolderToProfile(folderId, profileId);

  return NextResponse.json({ success: true, folderId, profileId });
});

/**
 * DELETE /api/profiles/folders/:folderId - Unlink folder from profile
 */
export const DELETE = withAuth(async (_request, { params }) => {
  const folderId = params!.folderId;

  await AgentProfileService.unlinkFolderFromProfile(folderId);

  return NextResponse.json({ success: true, folderId });
});
