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
import { withApiAuth } from "@/lib/api";
import {
  requireOwnedPool,
  loadPoolMemberViews,
} from "@/app/api/_lib/claude-pool";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const owned = await requireOwnedPool(params, userId);
  if ("error" in owned) return owned.error;

  const members = await loadPoolMemberViews(owned.poolId, userId);

  return NextResponse.json({
    poolId: owned.pool.id,
    name: owned.pool.name,
    members,
  });
});
