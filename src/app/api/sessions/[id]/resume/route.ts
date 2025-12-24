import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/resume - Resume a suspended session
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    await SessionService.resumeSession(params!.id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      let status = 400;
      if (error.code === "SESSION_NOT_FOUND") status = 404;
      if (error.code === "TMUX_SESSION_GONE") status = 410; // Gone
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});
