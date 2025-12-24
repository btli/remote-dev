import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as TrashService from "@/services/trash-service";
import * as WorktreeTrashService from "@/services/worktree-trash-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/trash/:id/restore - Restore from trash
 * Body:
 *   - restorePath: Optional override path (for worktrees)
 *   - targetFolderId: Optional folder to restore to
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { restorePath, targetFolderId } = body;

    await TrashService.restoreResource(id, session.user.id, {
      restorePath,
      targetFolderId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error restoring from trash:", error);

    if (error instanceof TrashService.TrashServiceError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error instanceof WorktreeTrashService.WorktreeTrashServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to restore from trash" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trash/:id/restore - Check if original path is available
 * Returns info about whether restore can proceed automatically
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const item = await TrashService.getTrashItem(id, session.user.id);
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isPathAvailable = await WorktreeTrashService.isOriginalPathAvailable(
      id,
      session.user.id
    );

    const originalFolderId = await WorktreeTrashService.getOriginalFolderIfExists(
      id,
      session.user.id
    );

    return NextResponse.json({
      isPathAvailable,
      originalFolderId,
      item,
    });
  } catch (error) {
    console.error("Error checking restore availability:", error);
    return NextResponse.json(
      { error: "Failed to check restore availability" },
      { status: 500 }
    );
  }
}
