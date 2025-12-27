import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { reorderFoldersUseCase } from "@/infrastructure/container";
import { BusinessRuleViolationError } from "@/domain/errors/DomainError";

/**
 * POST /api/folders/reorder - Reorder folders (update sort order)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { folderIds } = body;

  if (!Array.isArray(folderIds)) {
    return errorResponse("folderIds must be an array", 400);
  }

  try {
    await reorderFoldersUseCase.execute({ userId, folderIds });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof BusinessRuleViolationError) {
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }
});
