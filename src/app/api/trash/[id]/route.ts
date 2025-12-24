import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as TrashService from "@/services/trash-service";

/**
 * GET /api/trash/:id - Get trash item details
 */
export const GET = withAuth(async (_request, { userId, params }) => {
  const item = await TrashService.getTrashItem(params!.id, userId);

  if (!item) {
    return errorResponse("Not found", 404);
  }

  return NextResponse.json({ item });
});

/**
 * DELETE /api/trash/:id - Permanently delete from trash
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    await TrashService.deleteTrashItem(params!.id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TrashService.TrashServiceError) {
      if (error.code === "NOT_FOUND") {
        return errorResponse("Not found", 404);
      }
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }
});
