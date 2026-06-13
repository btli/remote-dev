/**
 * GET | POST /api/claude-pools - Claude fallback-pool collection. [remote-dev-wb0q]
 *
 * A pool is a named, ordered set of Claude profiles a project rotates through
 * when its primary is limited. All pools are scoped to the authenticated user.
 *
 * GET  -> the user's pools, each with a cheap member count.
 * POST -> create a pool `{ name }` and return it (with memberCount 0).
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { profilePoolRepository } from "@/infrastructure/container";

export const dynamic = "force-dynamic";

/**
 * GET /api/claude-pools - list the user's pools with member counts.
 */
export const GET = withApiAuth(async (_request, { userId }) => {
  const pools = await profilePoolRepository.poolsForUser(userId);

  // Member count is cheap (small pools); fetch per-pool in parallel.
  const withCounts = await Promise.all(
    pools.map(async (pool) => {
      const members = await profilePoolRepository.membersOfPool(pool.id);
      return { ...pool, memberCount: members.length };
    })
  );

  return NextResponse.json({ pools: withCounts });
});

/**
 * POST /api/claude-pools - create a pool.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{ name?: string }>(request);
  if ("error" in result) return result.error;

  const name = result.data.name?.trim();
  if (!name) return errorResponse("Pool name is required", 400);

  const poolId = await profilePoolRepository.createPool(userId, name);

  return NextResponse.json(
    { id: poolId, name, memberCount: 0 },
    { status: 201 }
  );
});
