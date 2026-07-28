/**
 * GET | PUT | DELETE /api/claude-pools/[poolId] - a single pool. [remote-dev-wb0q]
 *
 * All verbs are ownership-checked: the pool must belong to the caller (via
 * `profilePoolRepository.getPool`, which returns null for missing/foreign
 * pools → 404, never leaking another user's pool).
 *
 * GET    -> the pool plus its members, each resolved to an account label +
 *           serialized limit state (members owned by other users are omitted).
 * PUT    -> rename `{ name }`.
 * DELETE -> delete the pool (members cascade).
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  profilePoolRepository,
  usageLimitStateRepository,
} from "@/infrastructure/container";
import { listAccounts } from "@/services/claude-account-service";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";

export const dynamic = "force-dynamic";

/**
 * GET /api/claude-pools/:poolId - pool + members (name + limit state).
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const [members, accounts] = await Promise.all([
    profilePoolRepository.membersOfPool(poolId),
    listAccounts(userId),
  ]);

  // Only the caller's accounts are nameable; foreign accountIds are dropped.
  const nameById = new Map(
    accounts.map((a) => [a.id, a.alias ?? a.emailAddress ?? null])
  );
  const ownedMembers = members.filter((m) => nameById.has(m.accountId));

  const limitStates = await usageLimitStateRepository.findManyByAccountIds(
    ownedMembers.map((m) => m.accountId)
  );

  const memberViews = ownedMembers.map((m) => ({
    accountId: m.accountId,
    name: nameById.get(m.accountId) ?? null,
    priority: m.priority,
    limitState: serializeLimitState(limitStates.get(m.accountId) ?? null),
  }));

  return NextResponse.json({ ...pool, members: memberViews });
});

/**
 * PUT /api/claude-pools/:poolId - rename.
 */
export const PUT = withApiAuth(async (request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  const result = await parseJsonBody<{ name?: string }>(request);
  if ("error" in result) return result.error;

  const name = result.data.name?.trim();
  if (!name) return errorResponse("Pool name is required", 400);

  await profilePoolRepository.renamePool(poolId, name);

  return NextResponse.json({ id: poolId, name });
});

/**
 * DELETE /api/claude-pools/:poolId - delete (members cascade).
 */
export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const poolId = params?.poolId;
  if (!poolId) return errorResponse("Pool ID is required", 400);

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return errorResponse("Pool not found", 404);

  await profilePoolRepository.deletePool(poolId);

  return new NextResponse(null, { status: 204 });
});
