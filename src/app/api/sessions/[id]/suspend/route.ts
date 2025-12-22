import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as SessionService from "@/services/session-service";

/**
 * POST /api/sessions/:id/suspend - Suspend a session (detach tmux)
 */
export const POST = withAuth(async (_request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) return errorResponse("Session ID required", 400);

    await SessionService.suspendSession(id, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error suspending session:", error);

    if (error instanceof SessionService.SessionServiceError) {
      const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
      return errorResponse(error.message, status, error.code);
    }

    return errorResponse("Failed to suspend session", 500);
  }
});
