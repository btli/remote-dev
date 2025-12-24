import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/suspend - Suspend a session (detach tmux)
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    await SessionService.suspendSession(params!.id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }
    throw error;
  }
});
