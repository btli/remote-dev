import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { moveSessionToFolderUseCase } from "@/infrastructure/container";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

/**
 * PUT /api/sessions/:id/folder - Move a session to a folder (or remove from folder)
 */
export const PUT = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { folderId } = body;

  // folderId can be null (to remove from folder) or a string (to move to folder)
  if (folderId !== null && typeof folderId !== "string") {
    return errorResponse("folderId must be a string or null", 400);
  }

  try {
    await moveSessionToFolderUseCase.execute({
      sessionId: params!.id,
      userId,
      folderId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    throw error;
  }
});
