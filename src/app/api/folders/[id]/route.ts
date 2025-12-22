import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * PATCH /api/folders/:id - Update a folder
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Folder ID required", 400);

    const body = await request.json();
    const { name, collapsed, sortOrder } = body;

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
  } catch (error) {
    console.error("Error updating folder:", error);
    return errorResponse("Failed to update folder", 500);
  }
});

/**
 * DELETE /api/folders/:id - Delete a folder
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Folder ID required", 400);

    const deleted = await FolderService.deleteFolder(id, userId);

    if (!deleted) {
      return errorResponse("Folder not found", 404);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return errorResponse("Failed to delete folder", 500);
  }
});
