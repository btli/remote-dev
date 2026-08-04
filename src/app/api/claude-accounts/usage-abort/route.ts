/**
 * POST /api/claude-accounts/usage-abort - best-effort cancellation of an
 * isolated Claude usage login. Session ownership is the authority gate and the
 * scratch path comes only from server-owned setup metadata.
 */

import { NextResponse } from "next/server";
import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import { CLAUDE_USAGE_SETUP_SESSION_MARKER } from "@/services/claude-account-service";
import { abortUsageCredentialCapture } from "@/services/claude-usage-credential-service";
import * as SessionService from "@/services/session-service";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/usage-abort");

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{ sessionId?: unknown }>(request);
  if ("error" in result) return result.error;
  if (!isRecord(result.data)) {
    return errorResponse("Request body must be a JSON object", 400);
  }

  const { sessionId } = result.data;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return errorResponse("sessionId is required and must be a string", 400);
  }

  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return errorResponse("Session not found", 404);

  const metadata = session.typeMetadata;
  if (metadata?.[CLAUDE_USAGE_SETUP_SESSION_MARKER] !== true) {
    return errorResponse(
      "That session was not started by the Claude usage tracking flow",
      400,
      "NOT_A_USAGE_SETUP_SESSION"
    );
  }

  const scratchDir = metadata.scratchDir;
  if (typeof scratchDir !== "string" || scratchDir.trim().length === 0) {
    return errorResponse(
      "Usage setup session metadata is incomplete",
      400,
      "INVALID_USAGE_SETUP_SESSION"
    );
  }

  try {
    const cleanupComplete = await abortUsageCredentialCapture({
      userId,
      sessionId,
      tmuxSessionName: session.tmuxSessionName,
      scratchDir,
    });
    return NextResponse.json({ cleanupComplete });
  } catch (error) {
    log.error("Could not abort Claude usage credential setup", {
      sessionId,
      error: String(error),
    });
    return errorResponse(
      "Could not clean up the Claude usage sign-in session",
      500,
      "ABORT_FAILED"
    );
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
