/**
 * POST /api/claude-accounts/usage-capture - finish isolated usage OAuth.
 *
 * Session ownership is the first authority gate. Provenance, target account,
 * and scratch directory then come exclusively from the session's server-owned
 * `typeMetadata`; request-body account/path values are ignored. Account
 * ownership is re-checked before the trusted values reach orchestration.
 *
 * Successful responses expose only the token-free account view plus three
 * booleans: whether an immediate usage snapshot was recorded, whether all
 * best-effort cleanup steps completed, and whether scheduled usage polling is
 * enabled. Expected retry/action failures are stable 409 codes; environmental
 * errors are collapsed to a generic response and logged at error level with a
 * typed classification when one is available.
 */

import { NextResponse } from "next/server";
import { CredentialHarvesterError } from "@/infrastructure/external/claude-credential-harvester";
import { isUsagePollEnabled } from "@/infrastructure/usage-limit/poll-config";
import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import {
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  getAccount,
} from "@/services/claude-account-service";
import {
  captureUsageCredential,
  UsageCredentialCaptureError,
  type UsageCredentialCaptureResult,
} from "@/services/claude-usage-credential-service";
import * as SessionService from "@/services/session-service";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts/usage-capture");

const captureMessages = {
  CREDENTIALS_NOT_READY:
    "Finish the Claude sign-in, then try again.",
  MISSING_SCOPE:
    "This Claude login did not grant user:profile. Sign in again, then choose Finish.",
  ACCOUNT_MISMATCH:
    "You signed into a different Claude account than this row. Sign in with the matching account and try again.",
} as const;

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{ sessionId?: unknown }>(request);
  if ("error" in result) return result.error;
  if (!isRecord(result.data)) {
    return errorResponse("Request body must be a JSON object", 400);
  }

  const { sessionId } = result.data;
  if (
    typeof sessionId !== "string" ||
    sessionId.trim().length === 0
  ) {
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

  const accountId = metadata.accountId;
  const scratchDir = metadata.scratchDir;
  if (
    typeof accountId !== "string" ||
    accountId.trim().length === 0 ||
    typeof scratchDir !== "string" ||
    scratchDir.trim().length === 0
  ) {
    return errorResponse(
      "Usage setup session metadata is incomplete",
      400,
      "INVALID_USAGE_SETUP_SESSION"
    );
  }

  const account = await getAccount(accountId, userId);
  if (!account) return errorResponse("Claude account not found", 404);

  let captured: UsageCredentialCaptureResult;
  try {
    captured = await captureUsageCredential({
      userId,
      accountId,
      targetEmail: account.emailAddress,
      sessionId,
      tmuxSessionName: session.tmuxSessionName,
      scratchDir,
    });
  } catch (error) {
    if (error instanceof UsageCredentialCaptureError) {
      return errorResponse(
        captureMessages[error.code],
        409,
        error.code
      );
    }
    log.error("Claude usage credential capture failed", {
      sessionId,
      accountId,
      classification:
        error instanceof CredentialHarvesterError
          ? error.code
          : error instanceof Error
            ? error.name
            : "UnknownCaptureFailure",
      error: String(error),
    });
    return errorResponse(
      "Could not capture Claude usage credentials. Try again from the sign-in session.",
      409,
      "CAPTURE_FAILED"
    );
  }

  if (!captured.account) return errorResponse("Claude account not found", 404);

  return NextResponse.json({
    account: captured.account,
    usageValidated: captured.usageValidated,
    cleanupComplete: captured.cleanupComplete,
    pollEnabled: isUsagePollEnabled(),
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
