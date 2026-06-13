/**
 * GET /api/claude-pools/[poolId]/status - pool availability snapshot.
 * [remote-dev-wb0q]
 *
 * For each pool member returns `{ profileId, name, priority, limitState }` so
 * the UI can show at a glance which profiles in the rotation are available vs
 * limited (and when they reset). Ownership-checked; members that resolve to a
 * profile not owned by the caller are omitted.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import {
  profilePoolRepository,
  usageLimitStateRepository,
} from "@/infrastructure/container";
import * as AgentProfileService from "@/services/agent-profile-service";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const [members, profiles] = await Promise.all([
    profilePoolRepository.membersOfPool(poolId),
    AgentProfileService.getProfiles(userId),
  ]);

  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  const ownedMembers = members.filter((m) => nameById.has(m.profileId));

  const limitStates = await usageLimitStateRepository.findManyByProfileIds(
    ownedMembers.map((m) => m.profileId)
  );

  const memberStatuses = ownedMembers.map((m) => ({
    profileId: m.profileId,
    name: nameById.get(m.profileId) ?? null,
    priority: m.priority,
    limitState: serializeLimitState(limitStates.get(m.profileId) ?? null),
  }));

  return NextResponse.json({
    poolId: pool.id,
    name: pool.name,
    members: memberStatuses,
  });
});
