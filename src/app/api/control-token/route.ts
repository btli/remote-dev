import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { generateWsToken, CONTROL_SESSION_SENTINEL } from "@/lib/ws-token";

/**
 * GET /api/control-token — short-lived token for a control-mode WebSocket.
 *
 * [remote-dev-d5ci] The control socket (`?control=1`) subscribes to broadcasts
 * (agent_activity_status / session_metadata) so the sidebar updates live even
 * when no terminal is attached. It binds to no real session, so the token is
 * minted with the reserved CONTROL_SESSION_SENTINEL sessionId — authenticated by
 * the same NextAuth/API-key auth and verified by the terminal server with the
 * same HMAC machinery as terminal tokens. Scoped to the caller's userId so
 * user-scoped broadcasts (session_metadata) reach the right tab.
 */
export const GET = withApiAuth(async (_request, { userId }) => {
  const token = generateWsToken(CONTROL_SESSION_SENTINEL, userId);
  return NextResponse.json({ token, expiresIn: 300 });
});
