import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as FolderService from "@/services/folder-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/sessions/:id/folder - Move a session to a folder (or remove from folder)
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sessionId } = await params;
    const body = await request.json();
    const { folderId } = body;

    // folderId can be null (to remove from folder) or a string (to move to folder)
    if (folderId !== null && typeof folderId !== "string") {
      return NextResponse.json(
        { error: "folderId must be a string or null" },
        { status: 400 }
      );
    }

    const success = await FolderService.moveSessionToFolder(
      sessionId,
      session.user.id,
      folderId
    );

    if (!success) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error moving session to folder:", error);
    return NextResponse.json(
      { error: "Failed to move session" },
      { status: 500 }
    );
  }
}
