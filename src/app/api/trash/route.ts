import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as TrashService from "@/services/trash-service";
import type { TrashResourceType } from "@/types/trash";

/**
 * GET /api/trash - List trash items with full metadata
 * Query params:
 *   - type: Filter by resource type (optional)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const resourceType = searchParams.get("type") as TrashResourceType | null;

  // Return items with full metadata for better UI display
  const items = await TrashService.listTrashItemsWithMetadata(
    userId,
    resourceType || undefined
  );

  return NextResponse.json({ items });
});

/**
 * POST /api/trash - Trigger cleanup of expired items
 */
export const POST = withAuth(async () => {
  const result = await TrashService.cleanupExpiredItems();

  return NextResponse.json({
    success: true,
    deletedCount: result.deletedCount,
  });
});

/**
 * DELETE /api/trash - Empty the user's trash entirely (regardless of expiresAt)
 *
 * This is the backend for the sidebar footer "Empty Permanently" affordance.
 * Unlike POST (which only purges items whose TTL elapsed), this deletes EVERY
 * trash item the user currently has, along with associated artifacts
 * (worktree filesystem trees) via the per-resource delete path.
 */
export const DELETE = withAuth(async (_request, { userId }) => {
  const result = await TrashService.emptyAllTrash(userId);

  return NextResponse.json({
    success: true,
    deletedCount: result.deletedCount,
  });
});
