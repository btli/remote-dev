import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * PATCH /api/folders/:id - Update a folder (or move to new parent)
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const body = await request.json();
  const { name, collapsed, sortOrder, parentId } = body;
  const id = params!.id;

  // Handle parent change separately (uses moveFolderToParent for validation)
  if (parentId !== undefined) {
    if (parentId !== null && typeof parentId !== "string") {
      return errorResponse("parentId must be a string or null", 400);
    }

    const folder = await FolderService.moveFolderToParent(id, userId, parentId);

    if (!folder) {
      return errorResponse("Folder not found", 404);
    }

    // If there are other updates, apply them too
    if (typeof name === "string" || typeof collapsed === "boolean") {
      const additionalUpdates: Partial<{ name: string; collapsed: boolean }> = {};
      if (typeof name === "string") additionalUpdates.name = name;
      if (typeof collapsed === "boolean") additionalUpdates.collapsed = collapsed;

      const updatedFolder = await FolderService.updateFolder(id, userId, additionalUpdates);
      return NextResponse.json(updatedFolder);
    }

    return NextResponse.json(folder);
  }

  // Standard updates (name, collapsed, sortOrder)
  const updates: Partial<{ name: string; collapsed: boolean; sortOrder: number }> = {};
  if (typeof name === "string") updates.name = name;
  if (typeof collapsed === "boolean") updates.collapsed = collapsed;
  if (typeof sortOrder === "number") updates.sortOrder = sortOrder;

  if (Object.keys(updates).length === 0) {
    return errorResponse("No valid updates provided", 400);
  }

  const folder = await FolderService.updateFolder(id, userId, updates);

  if (!folder) {
    return errorResponse("Folder not found", 404);
  }

  return NextResponse.json(folder);
});

/**
 * DELETE /api/folders/:id - Delete a folder
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await FolderService.deleteFolder(params!.id, userId);

  if (!deleted) {
    return errorResponse("Folder not found", 404);
  }

  return NextResponse.json({ success: true });
});
