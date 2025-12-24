import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import * as TrashService from "@/services/trash-service";
import type { TrashResourceType } from "@/types/trash";

/**
 * GET /api/trash - List trash items
 * Query params:
 *   - type: Filter by resource type (optional)
 */
export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const resourceType = searchParams.get("type") as TrashResourceType | null;

  const items = await TrashService.listTrashItems(
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
