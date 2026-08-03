/**
 * POST /api/claude-accounts/usage-setup-session - begin isolated usage OAuth.
 *
 * The target account is resolved by account id AND authenticated owner before
 * any session or filesystem effect. API-key accounts are rejected because the
 * usage endpoint has no API-key equivalent. An existing open marker session is
 * recovered, and same-process concurrent requests for one owner/account share
 * a single create flight. A new shell session is created first because its id
 * names the private scratch config directory; that exact directory is then
 * stamped into owner-scoped metadata as the capture route's only path authority.
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

interface UsageSetupResult {
  status: 200 | 201;
  body: {
    sessionId: string;
    command: string | null;
    commandSent: boolean | null;
    recovered: boolean;
    instructions: string[];
  };
}

const setupFlights = new Map<string, Promise<UsageSetupResult>>();

const instructions = [
  "Complete the Claude browser sign-in opened by the terminal.",
  "If no local browser opens, copy the terminal URL into a browser and paste the authorization code back into the terminal.",
  "Return here after sign-in and choose Finish to save usage tracking.",
];

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
  if (account.accountKind === "api_key") {
    return errorResponse(
      "Usage tracking is available only for Claude subscription accounts",
      400,
      "USAGE_TRACKING_UNSUPPORTED_ACCOUNT_KIND"
    );
  }

  const flightKey = JSON.stringify([userId, accountId]);
  let pending = setupFlights.get(flightKey);
  if (!pending) {
    pending = recoverOrCreateUsageSetup(userId, projectId, accountId);
    setupFlights.set(flightKey, pending);
  }
  try {
    const result = await pending;
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    if (setupFlights.get(flightKey) === pending) {
      setupFlights.delete(flightKey);
    }
  }
});

async function recoverOrCreateUsageSetup(
  userId: string,
  projectId: string,
  accountId: string
): Promise<UsageSetupResult> {
  const existing = (await SessionService.listSessions(userId)).find(
    (candidate) =>
      candidate.status !== "closed" &&
      candidate.status !== "trashed" &&
      candidate.typeMetadata?.[CLAUDE_USAGE_SETUP_SESSION_MARKER] === true &&
      candidate.typeMetadata.accountId === accountId &&
      typeof candidate.typeMetadata.scratchDir === "string" &&
      candidate.typeMetadata.scratchDir.trim().length > 0
  );
  if (existing) {
    return {
      status: 200,
      body: {
        sessionId: existing.id,
        command: null,
        commandSent: null,
        recovered: true,
        instructions,
      },
    };
  }

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

  return {
    status: 201,
    body: {
      sessionId: session.id,
      command: prepared.command,
      commandSent,
      recovered: false,
      instructions,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
