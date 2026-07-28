/**
 * GET /api/claude-pools/[poolId]/status - pool availability snapshot.
 * [remote-dev-wb0q]
 *
 * For each pool member returns `{ accountId, name, priority, limitState }` so
 * the UI can show at a glance which accounts in the rotation are available vs
 * limited (and when they reset). Ownership-checked; members that resolve to an
 * account not owned by the caller are omitted.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import {
  profilePoolRepository,
  usageLimitStateRepository,
} from "@/infrastructure/container";
import { listAccounts } from "@/services/claude-account-service";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const [members, accounts] = await Promise.all([
    profilePoolRepository.membersOfPool(poolId),
    listAccounts(userId),
  ]);

  const nameById = new Map(
    accounts.map((a) => [a.id, a.alias ?? a.emailAddress ?? null])
  );
  const ownedMembers = members.filter((m) => nameById.has(m.accountId));

  const limitStates = await usageLimitStateRepository.findManyByAccountIds(
    ownedMembers.map((m) => m.accountId)
  );

  const memberStatuses = ownedMembers.map((m) => ({
    accountId: m.accountId,
    name: nameById.get(m.accountId) ?? null,
    priority: m.priority,
    limitState: serializeLimitState(limitStates.get(m.accountId) ?? null),
  }));

  return NextResponse.json({
    poolId: pool.id,
    name: pool.name,
    members: memberStatuses,
  });
});
