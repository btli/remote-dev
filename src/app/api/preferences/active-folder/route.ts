import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setActiveFolder } from "@/services/preferences-service";

/**
 * POST /api/preferences/active-folder
 * Sets the active folder for quick terminal creation
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { folderId, pinned = false } = await request.json();

    // folderId can be null to clear the active folder
    if (folderId !== null && typeof folderId !== "string") {
      return NextResponse.json(
        { error: "Invalid folderId" },
        { status: 400 }
      );
    }

    const updated = await setActiveFolder(session.user.id, folderId, pinned);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error setting active folder:", error);
    return NextResponse.json(
      { error: "Failed to set active folder" },
      { status: 500 }
    );
  }
}
