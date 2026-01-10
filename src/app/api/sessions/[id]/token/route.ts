import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import { generateWsToken } from "@/server/terminal";

/**
 * GET /api/sessions/:id/token - Get WebSocket authentication token
 *
 * Verifies session ownership via rdv-server, then generates token
 * for the Node.js terminal WebSocket server.
 *
 * Note: Token generation stays in Next.js because the terminal
 * WebSocket server is in Node.js. Consider moving both to Rust.
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  const sessionId = params?.id;
  if (!sessionId) {
    return errorResponse("Session ID is required", 400, "ID_REQUIRED");
  }

  // Verify session exists and belongs to user via rdv-server
  const sessionResponse = await proxyToRdvServer(request, userId, {
    path: `/sessions/${sessionId}`,
  });

  if (!sessionResponse.ok) {
    return sessionResponse;
  }

  const session = await sessionResponse.json();
  const token = generateWsToken(sessionId, userId);

  return NextResponse.json({
    token,
    sessionId,
    tmuxSessionName: session.tmux_session_name,
    expiresIn: 300, // 5 minutes
  });
});
