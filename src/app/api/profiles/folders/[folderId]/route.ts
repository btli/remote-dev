import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as AgentProfileService from "@/services/agent-profile-service";

/**
 * Helper to verify folder ownership
 */
async function verifyFolderOwnership(
  folderId: string,
  userId: string
): Promise<boolean> {
  const folder = await db.query.sessionFolders.findFirst({
    where: and(eq(sessionFolders.id, folderId), eq(sessionFolders.userId, userId)),
  });
  return !!folder;
}

/**
 * PUT /api/profiles/folders/:folderId - Link folder to a profile
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const folderId = params!.folderId;

  // Verify folder ownership
  if (!(await verifyFolderOwnership(folderId, userId))) {
    return errorResponse("Folder not found", 404);
  }

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
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const folderId = params!.folderId;

  // Verify folder ownership
  if (!(await verifyFolderOwnership(folderId, userId))) {
    return errorResponse("Folder not found", 404);
  }

  await AgentProfileService.unlinkFolderFromProfile(folderId);

  return NextResponse.json({ success: true, folderId });
});
