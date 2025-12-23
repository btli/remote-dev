import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { generateWsToken } from "@/server/terminal";
import * as SessionService from "@/services/session-service";

/**
 * GET /api/sessions/:id/token - Get WebSocket authentication token
 *
 * Returns a short-lived token (5 minutes) for connecting to the terminal WebSocket.
 * Supports both session auth and API key auth for agent access.
 *
 * Agent workflow:
 * 1. GET /api/sessions/:id/token (with API key)
 * 2. Connect to ws://host:3001?token=<token>&tmuxSession=<tmuxSessionName>
 * 3. Send: { type: "input", data: "command\n" }
 * 4. Receive: { type: "output", data: "..." }
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) {
    return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  }

  // Verify the session belongs to this user
  const terminalSession = await SessionService.getSession(sessionId, userId);
  if (!terminalSession) {
    return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
  }

  const token = generateWsToken(sessionId, userId);

  return NextResponse.json({
    token,
    sessionId,
    tmuxSessionName: terminalSession.tmuxSessionName,
    expiresIn: 300, // 5 minutes
  });
});
