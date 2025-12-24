import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as TrashService from "@/services/trash-service";
import type { TrashResourceType } from "@/types/trash";

/**
 * GET /api/trash - List trash items
 * Query params:
 *   - type: Filter by resource type (optional)
 */
export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const resourceType = searchParams.get("type") as TrashResourceType | null;

    const items = await TrashService.listTrashItems(
      session.user.id,
      resourceType || undefined
    );

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error listing trash:", error);
    return NextResponse.json(
      { error: "Failed to list trash items" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trash - Trigger cleanup of expired items
 */
export async function POST() {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await TrashService.cleanupExpiredItems();

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error cleaning up trash:", error);
    return NextResponse.json(
      { error: "Failed to cleanup expired items" },
      { status: 500 }
    );
  }
}
