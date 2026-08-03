/**
 * POST /api/claude-accounts/usage-setup-session - begin isolated usage OAuth.
 *
 * The target account is resolved by account id AND authenticated owner before
 * any session or filesystem effect. A shell session is created first because
 * its generated id names the private scratch config directory. That exact
 * directory is then stamped into owner-scoped session metadata and is the only
 * path the capture route is allowed to trust.
 *
 * Automatic command entry is best-effort. A send failure leaves the prepared
 * terminal open and returns the exact safely-quoted command for manual use.
 * Preparation/metadata failures instead close the newly-created session
 * best-effort because no usable flow was handed to the caller.
 */

import { NextResponse } from "next/server";
import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import {
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  getAccount,
} from "@/services/claude-account-service";
import {
  prepareUsageCredentialScratch,
  removeUsageCredentialScratch,
} from "@/services/claude-usage-credential-service";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/usage-setup-session");

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    projectId?: unknown;
    accountId?: unknown;
  }>(request);
  if ("error" in result) return result.error;
  if (!isRecord(result.data)) {
    return errorResponse("Request body must be a JSON object", 400);
  }

  const { projectId, accountId } = result.data;
  if (
    typeof projectId !== "string" ||
    projectId.trim().length === 0
  ) {
    return errorResponse("projectId is required and must be a string", 400);
  }
  if (
    typeof accountId !== "string" ||
    accountId.trim().length === 0
  ) {
    return errorResponse("accountId is required and must be a string", 400);
  }

  const account = await getAccount(accountId, userId);
  if (!account) return errorResponse("Claude account not found", 404);

  const session = await SessionService.createSession(userId, {
    name: "Enable Claude usage tracking",
    projectId,
    terminalType: "shell",
    autoLaunchAgent: false,
    initialCols: 220,
    initialRows: 50,
    typeMetadata: {
      [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
      accountId,
    },
  });

  let prepared: Awaited<
    ReturnType<typeof prepareUsageCredentialScratch>
  > | null = null;
  try {
    prepared = await prepareUsageCredentialScratch(session.id);
    await SessionService.updateSession(session.id, userId, {
      typeMetadataPatch: { scratchDir: prepared.scratchDir },
    });
  } catch (error) {
    log.error("Could not prepare Claude usage login session", {
      sessionId: session.id,
      error: String(error),
    });
    if (prepared) {
      try {
        await removeUsageCredentialScratch(prepared.scratchDir);
      } catch (removeError) {
        log.error("Could not remove failed Claude usage scratch directory", {
          sessionId: session.id,
          error: String(removeError),
        });
      }
    }
    try {
      await SessionService.closeSession(session.id, userId);
    } catch (closeError) {
      log.error("Could not close failed Claude usage login session", {
        sessionId: session.id,
        error: String(closeError),
      });
    }
    throw error;
  }

  if (!prepared) {
    throw new Error("Claude usage scratch preparation did not return a result");
  }

  let commandSent = true;
  try {
    await TmuxService.sendKeys(session.tmuxSessionName, prepared.command);
  } catch (error) {
    commandSent = false;
    log.warn("Could not auto-run Claude usage login command", {
      sessionId: session.id,
      error: String(error),
    });
  }

  return NextResponse.json(
    {
      sessionId: session.id,
      command: prepared.command,
      commandSent,
      instructions: [
        "Complete the Claude browser sign-in opened by the terminal.",
        "If no local browser opens, copy the terminal URL into a browser and paste the authorization code back into the terminal.",
        "Return here after sign-in and choose Finish to save usage tracking.",
      ],
    },
    { status: 201 }
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
