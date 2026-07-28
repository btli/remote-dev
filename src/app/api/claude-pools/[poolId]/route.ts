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
import { profilePoolRepository } from "@/infrastructure/container";
import {
  requireOwnedPool,
  loadPoolMemberViews,
} from "@/app/api/_lib/claude-pool";

export const dynamic = "force-dynamic";

/**
 * GET /api/claude-pools/:poolId - pool + members (name + limit state).
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  const members = await loadPoolMemberViews(owned.poolId, userId);
  return NextResponse.json({ ...owned.pool, members });
});

/**
 * PUT /api/claude-pools/:poolId - rename.
 */
export const PUT = withApiAuth(async (request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  const result = await parseJsonBody<{ name?: string }>(request);
  if ("error" in result) return result.error;

  const name = result.data.name?.trim();
  if (!name) return errorResponse("Pool name is required", 400);

  await profilePoolRepository.renamePool(owned.poolId, name);

  return NextResponse.json({ id: owned.poolId, name });
});

/**
 * DELETE /api/claude-pools/:poolId - delete (members cascade).
 */
export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  await profilePoolRepository.deletePool(owned.poolId);

  return new NextResponse(null, { status: 204 });
});
