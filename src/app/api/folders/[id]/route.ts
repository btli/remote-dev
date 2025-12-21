import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as FolderService from "@/services/folder-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/folders/:id - Update a folder (or move to new parent)
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, collapsed, sortOrder, parentId } = body;

    // Handle parent change separately (uses moveFolderToParent for validation)
    if (parentId !== undefined) {
      if (parentId !== null && typeof parentId !== "string") {
        return NextResponse.json(
          { error: "parentId must be a string or null" },
          { status: 400 }
        );
      }

      const folder = await FolderService.moveFolderToParent(id, session.user.id, parentId);

      if (!folder) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }

      // If there are other updates, apply them too
      if (typeof name === "string" || typeof collapsed === "boolean") {
        const additionalUpdates: Partial<{ name: string; collapsed: boolean }> = {};
        if (typeof name === "string") additionalUpdates.name = name;
        if (typeof collapsed === "boolean") additionalUpdates.collapsed = collapsed;

        const updatedFolder = await FolderService.updateFolder(id, session.user.id, additionalUpdates);
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
      return NextResponse.json(
        { error: "No valid updates provided" },
        { status: 400 }
      );
    }

    const folder = await FolderService.updateFolder(id, session.user.id, updates);

    if (!folder) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error updating folder:", error);
    const message = error instanceof Error ? error.message : "Failed to update folder";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/folders/:id - Delete a folder
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const deleted = await FolderService.deleteFolder(id, session.user.id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}
