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
 * The captured token is never returned in the response and never logged. Once
 * it is safely encrypted at rest, the setup session's scrollback is wiped and
 * the session is CLOSED — otherwise the long-lived token stays readable in
 * cleartext through the scrollback API, `rdv session scrollback`, and a plain
 * `tmux attach` for as long as that session lives. [remote-dev-n4x4.7]
 *
 * Deliberate carve-out [remote-dev-307w]: on a `TOKEN_TRUNCATED` rejection the
 * session stays OPEN and its scrollback is NOT wiped, so the user can widen
 * the terminal and retry. That is acceptable because what sits in scrollback
 * at that point is a clipped fragment Anthropic 401s — not a usable
 * credential; the wipe-and-close contract above applies to every path that
 * actually stored a token.
 *
 * Only sessions created by `POST /api/claude-accounts/setup-session` (which
 * stamps `CLAUDE_SETUP_SESSION_MARKER` into `typeMetadata`) can be captured
 * from, so this endpoint can never be aimed at an unrelated terminal.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  extractSetupToken,
  isLikelyTruncatedToken,
  saveAccountToken,
  AccountNotFoundError,
  CLAUDE_SETUP_SESSION_MARKER,
  TRUNCATED_TOKEN_MESSAGE,
  INVALID_TOKEN_MESSAGE,
} from "@/services/claude-account-service";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/capture");

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    sessionId?: unknown;
    alias?: unknown;
    accountId?: unknown;
  }>(request);
  if ("error" in result) return result.error;

  // Runtime-validate before any string method runs.
  const { sessionId } = result.data;
  if (typeof sessionId !== "string" || !sessionId) {
    return errorResponse("sessionId is required and must be a string", 400);
  }
  if (result.data.alias !== undefined && typeof result.data.alias !== "string") {
    return errorResponse("alias must be a string", 400);
  }
  if (
    result.data.accountId !== undefined &&
    result.data.accountId !== null &&
    typeof result.data.accountId !== "string"
  ) {
    return errorResponse("accountId must be a string", 400);
  }

  // Ownership: getSession is userId-scoped, so a foreign session 404s.
  const session = await SessionService.getSession(sessionId, userId);
  if (!session) return errorResponse("Session not found", 404);

  // Provenance: only a session we launched for `claude setup-token` may be
  // scraped, so this can't be turned into a "read any of my terminals" probe.
  const metadata = session.typeMetadata as Record<string, unknown> | null;
  if (!metadata?.[CLAUDE_SETUP_SESSION_MARKER]) {
    return errorResponse(
      "That session was not started by the Add Claude account flow",
      400,
      "NOT_A_SETUP_SESSION"
    );
  }

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

  // [remote-dev-307w] A real setup-token is ~108 chars; the setup TUI clips its
  // output at the pane width and `capture-pane -J` cannot rejoin TUI-authored
  // breaks, so a narrow pane leaves a 79-char fragment that still matches the
  // token pattern. Storing it produces a credential Anthropic will 401 forever
  // — reject with a distinct code instead, and leave the session OPEN so the
  // user can widen the terminal, re-run, or fall back to the paste flow.
  if (isLikelyTruncatedToken(token)) {
    log.warn("Captured setup-token looks truncated; refusing to store it", {
      sessionId,
      tokenLength: token.length,
    });
    return errorResponse(TRUNCATED_TOKEN_MESSAGE, 409, "TOKEN_TRUNCATED");
  }

  const alias = result.data.alias?.trim() || null;
  let saved: Awaited<ReturnType<typeof saveAccountToken>>;
  try {
    saved = await saveAccountToken({
      userId,
      token,
      alias,
      accountId: (result.data.accountId as string | undefined) ?? null,
    });
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      // The caller named an account that isn't theirs. Creating a new one would
      // be a surprising answer to "update this account".
      return errorResponse("Claude account not found", 404);
    }
    throw error;
  }
  const { account, identity, updated, tokenValid } = saved;

  // The token is now encrypted at rest, so destroy the cleartext copy sitting
  // in the pane. Wipe the scrollback FIRST (so even a failed close leaves
  // nothing readable), then close the session. Both are best-effort: the
  // account is already saved and must not be lost to a teardown hiccup — but a
  // failure is logged loudly because it means a live token is still exposed.
  let sessionClosed = true;
  try {
    await TmuxService.clearHistory(session.tmuxSessionName);
  } catch (error) {
    log.warn("Could not clear setup-session scrollback", {
      sessionId,
      error: String(error),
    });
  }
  try {
    await SessionService.closeSession(sessionId, userId);
  } catch (error) {
    sessionClosed = false;
    log.error(
      "Could not close setup session; its scrollback may still hold the token",
      { sessionId, error: String(error) }
    );
  }

  log.info("Captured Claude account token from setup session", {
    sessionId,
    accountId: account.id,
    updated,
    loggedIn: identity.loggedIn,
    tokenValid,
    sessionClosed,
  });

  // `tokenValid: false` [remote-dev-307w] means Anthropic 401'd the token at
  // save time: the account row exists (unhealthy) but the dialog must show
  // `tokenError` instead of "Signed in". Null = indeterminate (offline probe).
  return NextResponse.json({
    account,
    loggedIn: identity.loggedIn,
    updated,
    sessionClosed,
    tokenValid,
    ...(tokenValid === false ? { tokenError: INVALID_TOKEN_MESSAGE } : {}),
  });
});
