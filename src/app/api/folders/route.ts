import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  listFoldersUseCase,
  createFolderUseCase,
} from "@/infrastructure/container";
import { FolderPresenter } from "@/interface/presenters/FolderPresenter";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

/**
 * GET /api/folders - Get all folders and session mappings for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  const result = await listFoldersUseCase.execute({ userId });

  return NextResponse.json({
    folders: FolderPresenter.toResponseMany(result.folders),
    sessionFolders: result.sessionFolders,
  });
});

/**
 * POST /api/folders - Create a new folder (optionally nested)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { name, parentId } = body;

  if (!name || typeof name !== "string") {
    return errorResponse("Name is required", 400);
  }

  // Validate parentId if provided
  if (parentId !== undefined && parentId !== null && typeof parentId !== "string") {
    return errorResponse("parentId must be a string or null", 400);
  }

  try {
    const folder = await createFolderUseCase.execute({
      userId,
      name,
      parentId,
    });
    return NextResponse.json(FolderPresenter.toResponse(folder), { status: 201 });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    throw error;
  }
});
