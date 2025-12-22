import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import {
  getFolderPreferences,
  updateFolderPreferences,
  deleteFolderPreferences,
} from "@/services/preferences-service";

interface RouteParams {
  params: Promise<{ folderId: string }>;
}

/**
 * GET /api/preferences/folders/[folderId]
 * Returns folder-specific preference overrides
 */
export async function GET(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;

  try {
    const prefs = await getFolderPreferences(folderId, session.user.id);
    if (!prefs) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(prefs);
  } catch (error) {
    console.error("Error fetching folder preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch folder preferences" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/preferences/folders/[folderId]
 * Creates or updates folder-specific preference overrides
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;

  try {
    const updates = await request.json();

    // Validate updates
    const allowedFields = [
      "defaultWorkingDirectory",
      "defaultShell",
      "startupCommand",
      "theme",
      "fontSize",
      "fontFamily",
      "githubRepoId",
      "localRepoPath",
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = value;
      }
    }

    const updated = await updateFolderPreferences(
      folderId,
      session.user.id,
      filteredUpdates
    );
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating folder preferences:", error);
    if (error instanceof Error && error.message === "Folder not found") {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to update folder preferences" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/preferences/folders/[folderId]
 * Removes folder-specific preference overrides (reverts to user defaults)
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;

  try {
    const deleted = await deleteFolderPreferences(folderId, session.user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder preferences:", error);
    return NextResponse.json(
      { error: "Failed to delete folder preferences" },
      { status: 500 }
    );
  }
}
