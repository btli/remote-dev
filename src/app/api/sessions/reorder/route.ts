import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/reorder - Reorder sessions (update tab order)
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { sessionIds } = body;

    if (!Array.isArray(sessionIds)) {
      return errorResponse("sessionIds must be an array", 400);
    }

    await SessionService.reorderSessions(userId, sessionIds);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering sessions:", error);
    return errorResponse("Failed to reorder sessions", 500);
  }
});
