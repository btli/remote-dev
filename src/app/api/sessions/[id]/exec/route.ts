import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";

/**
 * POST /api/sessions/:id/exec - Execute a command in a terminal session (fire-and-forget)
 *
 * This is a convenience endpoint for simple fire-and-forget commands.
 * For real-time interaction, use WebSocket instead:
 *   1. GET /api/sessions/:id/token
 *   2. Connect to ws://host:3001?token=<token>&tmuxSession=<name>
 *   3. Send: { type: "input", data: "command\n" }
 *   4. Receive: { type: "output", data: "..." }
 *
 * Authentication: Supports both session auth and API key auth (Bearer token).
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    const sessionId = params?.id;
    if (!sessionId) {
      return errorResponse("Session ID is required", 400, "ID_REQUIRED");
    }

    const result = await parseJsonBody<{
      command: string;
      pressEnter?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const { command, pressEnter = true } = result.data;

    // Validate command
    if (!command || typeof command !== "string") {
      return errorResponse("Command is required", 400, "COMMAND_REQUIRED");
    }

    // Get session and verify ownership
    const session = await SessionService.getSession(sessionId, userId);
    if (!session) {
      return errorResponse("Session not found", 404, "SESSION_NOT_FOUND");
    }

    // Check session status
    if (session.status === "closed") {
      return errorResponse(
        "Session is closed",
        400,
        "SESSION_CLOSED"
      );
    }

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (!tmuxExists) {
      return errorResponse(
        "Terminal session no longer exists",
        410,
        "TMUX_SESSION_GONE"
      );
    }

    // Send the command
    await TmuxService.sendKeys(session.tmuxSessionName, command, pressEnter);

    // Update last activity
    await SessionService.touchSession(sessionId, userId);

    return NextResponse.json({
      success: true,
      sessionId,
      command,
      message: "Command sent. Use WebSocket for real-time output.",
    });
  } catch (error) {
    console.error("Error executing command:", error);

    if (error instanceof TmuxService.TmuxServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    if (error instanceof SessionService.SessionServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to execute command", 500);
  }
});
