import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as FolderService from "@/services/folder-service";

/**
 * GET /api/folders - Get all folders and session mappings for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [folders, sessionFolders] = await Promise.all([
      FolderService.getFolders(session.user.id),
      FolderService.getSessionFolderMappings(session.user.id),
    ]);

    return NextResponse.json({ folders, sessionFolders });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/folders - Create a new folder
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const folder = await FolderService.createFolder(session.user.id, name);

    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}
