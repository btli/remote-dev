/**
 * GET | POST | DELETE /api/claude-pools/[poolId]/members - pool membership.
 * [remote-dev-wb0q]
 *
 * Ownership is enforced twice: the pool must belong to the caller, and (for
 * POST) the profile being added must also belong to the caller — you cannot
 * add someone else's profile to your pool.
 *
 * GET    -> members ordered by priority.
 * POST   -> add/upsert `{ profileId, priority? }` (re-POST updates priority).
 * DELETE -> remove `{ profileId }` (body) or `?profileId=` (query).
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { profilePoolRepository } from "@/infrastructure/container";
import * as AgentProfileService from "@/services/agent-profile-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/claude-pools/:poolId/members - members by ascending priority.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const members = await profilePoolRepository.membersOfPool(poolId);
  return NextResponse.json({ members });
});

/**
 * POST /api/claude-pools/:poolId/members - add or upsert a member.
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const result = await parseJsonBody<{
    profileId?: string;
    priority?: number;
  }>(request);
  if ("error" in result) return result.error;

  const { profileId } = result.data;
  if (!profileId) return errorResponse("profileId is required", 400);

  if (result.data.priority !== undefined) {
    if (
      typeof result.data.priority !== "number" ||
      !Number.isFinite(result.data.priority)
    ) {
      return errorResponse("priority must be a number", 400);
    }
  }
  const priority = result.data.priority ?? 0;

  // Ownership: the profile being added must belong to the caller.
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) return errorResponse("Profile not found", 404);

  // addMember upserts (priority is updated on conflict).
  await profilePoolRepository.addMember(poolId, profileId, priority);

  return NextResponse.json({ poolId, profileId, priority }, { status: 201 });
});

/**
 * DELETE /api/claude-pools/:poolId/members - remove a member.
 *
 * `profileId` may come from the JSON body or the `?profileId=` query param.
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  // Prefer the query param; fall back to a JSON body if present.
  let profileId = new URL(request.url).searchParams.get("profileId") ?? undefined;
  if (!profileId) {
    const result = await parseJsonBody<{ profileId?: string }>(request);
    if ("error" in result) return result.error;
    profileId = result.data.profileId;
  }
  if (!profileId) return errorResponse("profileId is required", 400);

  await profilePoolRepository.removeMember(poolId, profileId);

  return new NextResponse(null, { status: 204 });
});
