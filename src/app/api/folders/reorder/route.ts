import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * POST /api/folders/reorder - Reorder folders (update sort order)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { folderIds } = body;

  if (!Array.isArray(folderIds)) {
    return errorResponse("folderIds must be an array", 400);
  }

  await FolderService.reorderFolders(userId, folderIds);
  return NextResponse.json({ success: true });
});
