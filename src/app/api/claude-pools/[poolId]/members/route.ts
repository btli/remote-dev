/**
 * GET | POST | DELETE /api/claude-pools/[poolId]/members - pool membership.
 * [remote-dev-wb0q]
 *
 * Ownership is enforced twice: the pool must belong to the caller, and (for
 * POST) the ACCOUNT being added must also belong to the caller — you cannot
 * add someone else's account to your pool.
 *
 * GET    -> members ordered by priority.
 * POST   -> add/upsert `{ accountId, priority? }` (re-POST updates priority).
 * DELETE -> remove `{ accountId }` (body) or `?accountId=` (query).
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { profilePoolRepository } from "@/infrastructure/container";
import { getAccount } from "@/services/claude-account-service";
import { requireOwnedPool } from "@/app/api/_lib/claude-pool";

export const dynamic = "force-dynamic";

/**
 * GET /api/claude-pools/:poolId/members - members by ascending priority.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  const members = await profilePoolRepository.membersOfPool(owned.poolId);
  return NextResponse.json({ members });
});

/**
 * POST /api/claude-pools/:poolId/members - add or upsert a member.
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  const result = await parseJsonBody<{
    accountId?: string;
    priority?: number;
  }>(request);
  if ("error" in result) return result.error;

  const { accountId } = result.data;
  if (!accountId) return errorResponse("accountId is required", 400);

  if (result.data.priority !== undefined) {
    if (
      typeof result.data.priority !== "number" ||
      !Number.isFinite(result.data.priority)
    ) {
      return errorResponse("priority must be a number", 400);
    }
  }
  const priority = result.data.priority ?? 0;

  // Ownership: the account being added must belong to the caller.
  const account = await getAccount(accountId, userId);
  if (!account) return errorResponse("Account not found", 404);

  // addMember upserts (priority is updated on conflict).
  await profilePoolRepository.addMember(owned.poolId, accountId, priority);

  return NextResponse.json(
    { poolId: owned.poolId, accountId, priority },
    { status: 201 }
  );
});

/**
 * DELETE /api/claude-pools/:poolId/members - remove a member.
 *
 * `accountId` may come from the JSON body or the `?accountId=` query param.
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  // Prefer the query param; fall back to a JSON body if present.
  let accountId = new URL(request.url).searchParams.get("accountId") ?? undefined;
  if (!accountId) {
    const result = await parseJsonBody<{ accountId?: string }>(request);
    if ("error" in result) return result.error;
    accountId = result.data.accountId;
  }
  if (!accountId) return errorResponse("accountId is required", 400);

  await profilePoolRepository.removeMember(owned.poolId, accountId);

  return new NextResponse(null, { status: 204 });
});
