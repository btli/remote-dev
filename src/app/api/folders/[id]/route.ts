import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as FolderService from "@/services/folder-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/folders/:id - Update a folder
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, collapsed, sortOrder } = body;

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
    return NextResponse.json(
      { error: "Failed to update folder" },
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
