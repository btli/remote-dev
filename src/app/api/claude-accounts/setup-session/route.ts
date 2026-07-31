/**
 * POST /api/claude-accounts/setup-session - start the "Add account" flow.
 * [remote-dev-n4x4.7]
 *
 * Launches a REAL terminal session and runs `claude setup-token` in it. The
 * user completes the OAuth sign-in in their browser; the CLI then prints a
 * long-lived token into the session, which
 * `POST /api/claude-accounts/capture` picks up and stores encrypted.
 *
 * This replaces the old three-surface flow (create a profile → "Log in" button
 * that only returned copy-paste instructions → a manual "Sync" that never
 * worked). There is no Sync step: identity is read from
 * `claude auth status --json` at capture time.
 *
 * Remote / PWA users with no local browser use the paste-a-token fallback
 * (`POST /api/claude-accounts` with `{ token }`) instead.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  CLAUDE_SETUP_TOKEN_COMMAND,
  CLAUDE_SETUP_SESSION_MARKER,
} from "@/services/claude-account-service";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/setup-session");

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    projectId?: unknown;
    profileId?: unknown;
  }>(request);
  if ("error" in result) return result.error;

  // Runtime-validate before these ids reach the session-create path.
  const { projectId, profileId } = result.data;
  if (typeof projectId !== "string" || !projectId) {
    return errorResponse("projectId is required and must be a string", 400);
  }
  if (profileId !== undefined && typeof profileId !== "string") {
    return errorResponse("profileId must be a string", 400);
  }

  const session = await SessionService.createSession(userId, {
    name: "Add Claude account",
    projectId,
    terminalType: "shell",
    // A shell session, NOT an agent session: we drive the `claude` CLI
    // ourselves and must not have an agent auto-launched over it.
    autoLaunchAgent: false,
    ...(profileId ? { profileId } : {}),
    // Provenance marker. `POST /api/claude-accounts/capture` refuses to scrape
    // a token out of any session that does not carry it, so the capture
    // endpoint can never be pointed at an unrelated terminal. It also lets any
    // future scrollback-persisting feature exclude these panes — they transit a
    // long-lived OAuth token in cleartext until capture wipes them.
    typeMetadata: { [CLAUDE_SETUP_SESSION_MARKER]: true },
  });

  // Type the command into the live pane. Best-effort: if this fails the session
  // still exists and the user can run the command themselves, so surface the
  // command in the response either way.
  let commandSent = true;
  try {
    await TmuxService.sendKeys(
      session.tmuxSessionName,
      CLAUDE_SETUP_TOKEN_COMMAND
    );
  } catch (error) {
    commandSent = false;
    log.warn("Could not auto-run setup-token in the new session", {
      sessionId: session.id,
      error: String(error),
    });
  }

  return NextResponse.json(
    {
      sessionId: session.id,
      command: CLAUDE_SETUP_TOKEN_COMMAND,
      commandSent,
      instructions: [
        "Complete the Claude sign-in in the browser window that opens.",
        "When the CLI prints your token, return here and choose Finish — the token is captured, stored encrypted, and this session is closed so the token does not linger in its scrollback.",
        "No local browser? Run `claude setup-token` anywhere and paste the token instead.",
      ],
    },
    { status: 201 }
  );
});
