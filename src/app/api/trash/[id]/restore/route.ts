import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as TrashService from "@/services/trash-service";
import * as WorktreeTrashService from "@/services/worktree-trash-service";

/**
 * POST /api/trash/:id/restore - Restore from trash
 * Body:
 *   - restorePath: Optional override path (for worktrees)
 *   - targetFolderId: Optional folder to restore to
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const body = await request.json().catch(() => ({}));
  const { restorePath, targetFolderId } = body;

  try {
    await TrashService.restoreResource(params!.id, userId, {
      restorePath,
      targetFolderId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TrashService.TrashServiceError) {
      if (error.code === "NOT_FOUND") {
        return errorResponse("Not found", 404);
      }
      return errorResponse(error.message, 400, error.code);
    }

    if (error instanceof WorktreeTrashService.WorktreeTrashServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 400 }
      );
    }

    throw error;
  }
});

/**
 * GET /api/trash/:id/restore - Check if original path is available
 * Returns info about whether restore can proceed automatically
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const item = await TrashService.getTrashItem(params!.id, userId);
  if (!item) {
    return errorResponse("Not found", 404);
  }

  const isPathAvailable = await WorktreeTrashService.isOriginalPathAvailable(
    params!.id,
    userId
  );

  const originalFolderId = await WorktreeTrashService.getOriginalFolderIfExists(
    params!.id,
    userId
  );

  return NextResponse.json({
    isPathAvailable,
    originalFolderId,
    item,
  });
});
