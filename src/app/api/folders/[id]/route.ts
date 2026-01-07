import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  updateFolderUseCase,
  moveFolderUseCase,
  deleteFolderUseCase,
} from "@/infrastructure/container";
import { FolderPresenter } from "@/interface/presenters/FolderPresenter";
import { EntityNotFoundError, BusinessRuleViolationError } from "@/domain/errors/DomainError";

/**
 * PATCH /api/folders/:id - Update a folder (or move to new parent)
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const result = await parseJsonBody<{
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
    parentId?: string | null;
  }>(request);
  if ("error" in result) return result.error;
  const { name, collapsed, sortOrder, parentId } = result.data;
  const folderId = params!.id;

  try {
    // Handle parent change separately (uses moveFolderUseCase for validation)
    if (parentId !== undefined) {
      if (parentId !== null && typeof parentId !== "string") {
        return errorResponse("parentId must be a string or null", 400);
      }

      let folder = await moveFolderUseCase.execute({
        folderId,
        userId,
        newParentId: parentId,
      });

      // If there are other updates, apply them too
      if (typeof name === "string" || typeof collapsed === "boolean") {
        folder = await updateFolderUseCase.execute({
          folderId,
          userId,
          name: typeof name === "string" ? name : undefined,
          collapsed: typeof collapsed === "boolean" ? collapsed : undefined,
        });
      }

      return NextResponse.json(FolderPresenter.toResponse(folder));
    }

    // Standard updates (name, collapsed, sortOrder)
    const hasName = typeof name === "string";
    const hasCollapsed = typeof collapsed === "boolean";
    const hasSortOrder = typeof sortOrder === "number";

    if (!hasName && !hasCollapsed && !hasSortOrder) {
      return errorResponse("No valid updates provided", 400);
    }

    const folder = await updateFolderUseCase.execute({
      folderId,
      userId,
      name: hasName ? name : undefined,
      collapsed: hasCollapsed ? collapsed : undefined,
      sortOrder: hasSortOrder ? sortOrder : undefined,
    });

    return NextResponse.json(FolderPresenter.toResponse(folder));
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    if (error instanceof BusinessRuleViolationError) {
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }
});

/**
 * DELETE /api/folders/:id - Delete a folder
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    await deleteFolderUseCase.execute({
      folderId: params!.id,
      userId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    throw error;
  }
});
