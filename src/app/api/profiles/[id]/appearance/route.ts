import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import * as ProfileAppearanceService from "@/services/agent-profile-appearance-service";
import type { UpdateProfileAppearanceInput } from "@/types/agent";

/**
 * GET /api/profiles/:id/appearance - Get appearance settings for a profile
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const appearance = await ProfileAppearanceService.getProfileAppearance(
    params!.id,
    userId
  );

  // Return null if no custom settings (uses user defaults)
  return NextResponse.json(appearance);
});

/**
 * PUT /api/profiles/:id/appearance - Update appearance settings for a profile
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  const result = await parseJsonBody<UpdateProfileAppearanceInput>(request);
  if ("error" in result) {
    return result.error;
  }

  const input = result.data;

  // Validate appearance mode
  if (
    input.appearanceMode &&
    !["light", "dark", "system"].includes(input.appearanceMode)
  ) {
    return errorResponse(
      "Invalid appearanceMode. Must be 'light', 'dark', or 'system'",
      400
    );
  }

  // Validate cursor style
  if (
    input.terminalCursorStyle &&
    !["block", "underline", "bar"].includes(input.terminalCursorStyle)
  ) {
    return errorResponse(
      "Invalid terminalCursorStyle. Must be 'block', 'underline', or 'bar'",
      400
    );
  }

  // Validate opacity
  if (
    input.terminalOpacity !== undefined &&
    (input.terminalOpacity < 0 || input.terminalOpacity > 100)
  ) {
    return errorResponse("terminalOpacity must be between 0 and 100", 400);
  }

  // Validate blur
  if (input.terminalBlur !== undefined && input.terminalBlur < 0) {
    return errorResponse("terminalBlur must be non-negative", 400);
  }

  const appearance = await ProfileAppearanceService.updateProfileAppearance(
    params!.id,
    userId,
    input
  );

  return NextResponse.json(appearance);
});

/**
 * DELETE /api/profiles/:id/appearance - Delete appearance settings (revert to user defaults)
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  // Verify profile ownership
  const profile = await AgentProfileService.getProfile(params!.id, userId);
  if (!profile) {
    return errorResponse("Profile not found", 404);
  }

  await ProfileAppearanceService.deleteProfileAppearance(params!.id, userId);

  return NextResponse.json({ success: true });
});
