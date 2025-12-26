import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/profiles/:id/git-identity - Get Git identity for a profile
 */
export const GET = withAuth(async (_request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const gitIdentity = await AgentProfileService.getProfileGitIdentity(id);
  return NextResponse.json(gitIdentity ?? null);
});

/**
 * PUT /api/profiles/:id/git-identity - Set Git identity for a profile
 */
export const PUT = withAuth(async (request, { userId }, { params }: RouteParams) => {
  const { id } = await params;

  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return errorResponse("Invalid JSON body", 400);
  }

  const { userName, userEmail, sshKeyPath, gpgKeyId, githubUsername } = body;

  // Validate required fields
  if (!userName || typeof userName !== "string") {
    return errorResponse("userName is required", 400);
  }
  if (!userEmail || typeof userEmail !== "string") {
    return errorResponse("userEmail is required", 400);
  }

  await AgentProfileService.setProfileGitIdentity(id, {
    userName,
    userEmail,
    sshKeyPath: sshKeyPath ?? undefined,
    gpgKeyId: gpgKeyId ?? undefined,
    githubUsername: githubUsername ?? undefined,
  });

  const gitIdentity = await AgentProfileService.getProfileGitIdentity(id);
  return NextResponse.json(gitIdentity);
});
