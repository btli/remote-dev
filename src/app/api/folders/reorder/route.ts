import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as FolderService from "@/services/folder-service";

/**
 * POST /api/folders/reorder - Reorder folders (update sort order)
 */
export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { folderIds } = body;

    if (!Array.isArray(folderIds)) {
      return NextResponse.json(
        { error: "folderIds must be an array" },
        { status: 400 }
      );
    }

    await FolderService.reorderFolders(session.user.id, folderIds);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering folders:", error);
    return NextResponse.json(
      { error: "Failed to reorder folders" },
      { status: 500 }
    );
  }
}
