import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * GET /api/folders - Get all folders and session mappings for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [folders, sessionFolders] = await Promise.all([
    FolderService.getFolders(userId),
    FolderService.getSessionFolderMappings(userId),
  ]);

  return NextResponse.json({ folders, sessionFolders });
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

  const folder = await FolderService.createFolder(userId, name, parentId);
  return NextResponse.json(folder, { status: 201 });
});
