/**
 * POST /api/claude-accounts/capture - finish the "Add account" flow.
 * [remote-dev-n4x4.7]
 *
 * Reads the scrollback of the `claude setup-token` session started by
 * `POST /api/claude-accounts/setup-session`, extracts the printed OAuth token,
 * stores it ENCRYPTED, and reads the account identity via
 * `claude auth status --json`. Creating or updating in place is decided by the
 * probed email, so re-adding a known account never duplicates it.
 *
 * The captured token is never returned in the response and never logged.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  extractSetupToken,
  saveAccountToken,
} from "@/services/claude-account-service";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/capture");

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    sessionId?: string;
    alias?: string;
    accountId?: string;
  }>(request);
  if ("error" in result) return result.error;

  const { sessionId } = result.data;
  if (!sessionId) return errorResponse("sessionId is required", 400);

  // Ownership: getSession is userId-scoped, so a foreign session 404s.
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return errorResponse("Session not found", 404);

  let output: string;
  try {
    output = await TmuxService.captureOutput(session.tmuxSessionName, 2000);
  } catch (error) {
    log.warn("Could not read setup-token session output", {
      sessionId,
      error: String(error),
    });
    return errorResponse(
      "Could not read the setup session. Paste the token manually instead.",
      409,
      "CAPTURE_FAILED"
    );
  }

  const token = extractSetupToken(output);
  if (!token) {
    return errorResponse(
      "No token found yet — finish the browser sign-in, then try again.",
      409,
      "TOKEN_NOT_READY"
    );
  }

  const alias = result.data.alias?.trim() || null;
  const { account, identity, updated } = await saveAccountToken({
    userId,
    token,
    alias,
    accountId: result.data.accountId ?? null,
  });

  log.info("Captured Claude account token from setup session", {
    sessionId,
    accountId: account.id,
    updated,
    loggedIn: identity.loggedIn,
  });

  return NextResponse.json({
    account,
    loggedIn: identity.loggedIn,
    updated,
  });
});
