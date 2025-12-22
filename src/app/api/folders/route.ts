import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as FolderService from "@/services/folder-service";

/**
 * GET /api/folders - Get all folders and session mappings for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    const [folders, sessionFolders] = await Promise.all([
      FolderService.getFolders(userId),
      FolderService.getSessionFolderMappings(userId),
    ]);

    return NextResponse.json({ folders, sessionFolders });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return errorResponse("Failed to fetch folders", 500);
  }
});

/**
 * POST /api/folders - Create a new folder
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ name?: string }>(request);
    if ("error" in result) return result.error;
    const { name } = result.data;

    if (!name || typeof name !== "string") {
      return errorResponse("Name is required", 400);
    }

    const folder = await FolderService.createFolder(userId, name);

    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    console.error("Error creating folder:", error);
    return errorResponse("Failed to create folder", 500);
  }
});
