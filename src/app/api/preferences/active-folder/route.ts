import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { setActiveFolder } from "@/services/preferences-service";

/**
 * POST /api/preferences/active-folder
 * Sets the active folder for quick terminal creation
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const { folderId, pinned = false } = await request.json();

    // folderId can be null to clear the active folder
    if (folderId !== null && typeof folderId !== "string") {
      return errorResponse("Invalid folderId", 400);
    }

    const updated = await setActiveFolder(userId, folderId, pinned);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error setting active folder:", error);
    return errorResponse("Failed to set active folder", 500);
  }
});
