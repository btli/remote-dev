/**
 * GET | POST /api/profiles/[id]/claude-login - per-profile file-based Claude
 * subscription login. [remote-dev-6nu9]
 *
 * GET  → current auth status (logged-in? email/tier/expiry, needs-relogin).
 *        Read-only; never returns a token.
 * POST → two actions:
 *   { action: "initiate" } → seed the file-based login path and return the
 *        command + env + steps the user runs to complete OAuth in a session.
 *   { action: "sync" } (default) → read back the profile's `.credentials.json`
 *        + `.claude.json` after a completed login and upsert `claude_account`
 *        (email/tier/kind=subscription). Returns the post-sync status.
 *
 * Ownership is enforced by the service (getProfile is userId-scoped); a missing
 * or non-Claude profile maps to 404 / 400.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as ClaudeLoginService from "@/services/claude-login-service";

export const dynamic = "force-dynamic";

/** GET /api/profiles/:id/claude-login - read auth status (no token). */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) return errorResponse("Profile ID is required", 400);

  try {
    const status = await ClaudeLoginService.getAuthStatus(profileId, userId);
    return NextResponse.json(status);
  } catch (error) {
    return mapServiceError(error);
  }
});

/** POST /api/profiles/:id/claude-login - initiate or sync a file-based login. */
export const POST = withApiAuth(async (request, { userId, params }) => {
  const profileId = params?.id;
  if (!profileId) return errorResponse("Profile ID is required", 400);

  // Body is optional (empty body → default "sync"). Read it tolerantly so an
  // empty POST is valid; only a malformed non-empty body is rejected.
  let action = "sync";
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as { action?: string };
      if (typeof parsed.action === "string") action = parsed.action;
    } catch {
      return errorResponse("Invalid JSON in request body", 400, "INVALID_JSON");
    }
  }

  try {
    if (action === "initiate") {
      const initiation = await ClaudeLoginService.initiateLogin(
        profileId,
        userId
      );
      return NextResponse.json(initiation);
    }
    if (action === "sync") {
      const status = await ClaudeLoginService.syncAccountFromCredentials(
        profileId,
        userId
      );
      return NextResponse.json(status);
    }
    return errorResponse(
      'Unknown action. Use { action: "initiate" } or { action: "sync" }',
      400,
      "INVALID_ACTION"
    );
  } catch (error) {
    return mapServiceError(error);
  }
});

/** Map service errors (missing / non-Claude profile) to HTTP responses. */
function mapServiceError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Profile not found") {
    return errorResponse("Profile not found", 404);
  }
  if (message === "Profile is not Claude-capable") {
    return errorResponse(message, 400, "NOT_CLAUDE_CAPABLE");
  }
  return errorResponse("Failed to process Claude login", 500);
}
