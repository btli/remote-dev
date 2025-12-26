import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { GitIdentity } from "@/types/agent";

/**
 * GET /api/profiles/:id/git-identity - Get Git identity for a profile
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const gitIdentity = await AgentProfileService.getProfileGitIdentity(params!.id);
  return NextResponse.json(gitIdentity ?? null);
});

/**
 * PUT /api/profiles/:id/git-identity - Set Git identity for a profile
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const result = await parseJsonBody<GitIdentity>(request);
  if ("error" in result) {
    return result.error;
  }

  const { userName, userEmail, sshKeyPath, gpgKeyId, githubUsername } = result.data;

  // Validate required fields
  if (!userName || typeof userName !== "string") {
    return errorResponse("userName is required", 400);
  }
  if (!userEmail || typeof userEmail !== "string") {
    return errorResponse("userEmail is required", 400);
  }

  await AgentProfileService.setProfileGitIdentity(params!.id, {
    userName,
    userEmail,
    sshKeyPath: sshKeyPath ?? undefined,
    gpgKeyId: gpgKeyId ?? undefined,
    githubUsername: githubUsername ?? undefined,
  });

  const gitIdentity = await AgentProfileService.getProfileGitIdentity(params!.id);
  return NextResponse.json(gitIdentity);
});
