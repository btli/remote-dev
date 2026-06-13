/**
 * GET | PATCH /api/profiles/[id]/limit-state - per-profile Claude usage limit.
 * [remote-dev-wb0q]
 *
 * GET returns the profile's serialized limit state (available/unknown default
 * when none recorded). PATCH `{ status: "available" }` is a manual override
 * that clears a limit: it calls TrackUsageLimitUseCase with `source: "manual"`,
 * which bypasses the staleness guard (a user action is authoritative).
 *
 * Both verbs enforce ownership: the profile must belong to the caller.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import {
  usageLimitStateRepository,
  trackUsageLimitUseCase,
} from "@/infrastructure/container";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/profiles/:id/limit-state - read the serialized limit state.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) return errorResponse("Profile ID is required", 400);

  // Ownership: getProfile is already userId-scoped.
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) return errorResponse("Profile not found", 404);

  const state = await usageLimitStateRepository.findByProfileId(profileId);
  return NextResponse.json(serializeLimitState(state));
});

/**
 * PATCH /api/profiles/:id/limit-state - manual override.
 *
 * Body: `{ status: "available" }`. Marks the profile available again (clears a
 * limit). Any other status is rejected — limiting a profile is a detection
 * concern, not a manual one.
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) return errorResponse("Profile ID is required", 400);

  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) return errorResponse("Profile not found", 404);

  const result = await parseJsonBody<{ status?: string }>(request);
  if ("error" in result) return result.error;

  const { status } = result.data;
  if (status !== "available") {
    return errorResponse(
      'Only { status: "available" } is supported (manual override clears a limit)',
      400,
      "INVALID_STATUS"
    );
  }

  // Manual source bypasses the staleness guard in the use-case.
  const { state } = await trackUsageLimitUseCase.execute({
    profileId,
    userId,
    source: "manual",
    isLimited: false,
  });

  return NextResponse.json(serializeLimitState(state));
});
