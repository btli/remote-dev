import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import { broadcastSidebarChanged } from "@/lib/broadcast";

/**
 * POST /api/sessions/reorder - Reorder sessions (update tab order)
 */
export const POST = withAuth(async (request, { userId }) => {
  const body = await request.json();
  const { sessionIds } = body;

  if (!Array.isArray(sessionIds)) {
    return errorResponse("sessionIds must be an array", 400);
  }

  await SessionService.reorderSessions(userId, sessionIds);
  broadcastSidebarChanged();
  return NextResponse.json({ success: true });
});
