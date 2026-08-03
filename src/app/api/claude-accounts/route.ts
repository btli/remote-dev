/**
 * GET | POST /api/claude-accounts - the user's Claude accounts.
 * [remote-dev-n4x4.6 / n4x4.7]
 *
 * An account is one Claude subscription. Accounts are standalone rows — they
 * are NOT tied to an agent profile, and every session shares the same Claude
 * config dir; the account only decides which `CLAUDE_CODE_OAUTH_TOKEN` gets
 * injected.
 *
 * GET  -> the user's accounts with alias / email / org / tier / auth health.
 *         NEVER includes the OAuth token — only `hasToken: boolean`.
 * POST -> the paste-a-token onboarding fallback: `{ token, alias? }`. Stores the
 *         token encrypted and reads identity via `claude auth status --json`
 *         plus a concurrent network validity probe [remote-dev-307w].
 *         Re-posting a token for a known email UPDATES that account in place.
 *         A pattern-valid token under 100 chars is rejected as
 *         `400 TOKEN_TRUNCATED` (a partial copy can only ever 401); the save
 *         response carries `tokenValid` (tri-state) and — exactly when it is
 *         false — a human-readable `tokenError`, so the UI can show the
 *         diagnosis instead of "Signed in".
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  listAccounts,
  saveAccountToken,
  looksLikeOAuthToken,
  isLikelyTruncatedToken,
  TRUNCATED_TOKEN_MESSAGE,
  INVALID_TOKEN_MESSAGE,
} from "@/services/claude-account-service";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/claude-accounts");

export const GET = withApiAuth(async (_request, { userId }) => {
  const accounts = await listAccounts(userId);
  return NextResponse.json({ accounts });
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{ token?: unknown; alias?: unknown }>(
    request
  );
  if ("error" in result) return result.error;

  // Runtime-validate: `parseJsonBody` only proves the body is JSON, so a
  // non-string `token` would otherwise reach `.trim()` and 500 instead of 400.
  if (typeof result.data.token !== "string") {
    return errorResponse("token is required and must be a string", 400);
  }
  if (result.data.alias !== undefined && typeof result.data.alias !== "string") {
    return errorResponse("alias must be a string", 400);
  }

  const token = result.data.token.trim();
  if (!token) return errorResponse("token is required", 400);
  if (!looksLikeOAuthToken(token)) {
    return errorResponse(
      "That does not look like a Claude OAuth token. Run `claude setup-token` and paste the sk-ant-oat… value.",
      400,
      "INVALID_TOKEN_FORMAT"
    );
  }
  // [remote-dev-307w] Same length floor as the capture path: a pattern-matching
  // token under ~100 chars is a partial copy (or a fragment a terminal clipped)
  // and can only ever 401 — give the user the truncation diagnosis up front
  // instead of storing a dead credential.
  if (isLikelyTruncatedToken(token)) {
    return errorResponse(TRUNCATED_TOKEN_MESSAGE, 400, "TOKEN_TRUNCATED");
  }

  const alias = result.data.alias?.trim() || null;

  try {
    const { account, identity, updated, tokenValid } = await saveAccountToken({
      userId,
      token,
      alias,
    });
    // The token itself is never logged — only whether the probes recognized it.
    log.info("Stored Claude account token", {
      accountId: account.id,
      updated,
      loggedIn: identity.loggedIn,
      tokenValid,
    });
    // `tokenValid: false` [remote-dev-307w] = Anthropic 401'd the token at save
    // time; the row exists (unhealthy) and the dialog shows `tokenError`
    // instead of "Signed in". Null = indeterminate (offline probe).
    return NextResponse.json(
      {
        account,
        loggedIn: identity.loggedIn,
        updated,
        tokenValid,
        ...(tokenValid === false ? { tokenError: INVALID_TOKEN_MESSAGE } : {}),
      },
      { status: updated ? 200 : 201 }
    );
  } catch (error) {
    log.error("Failed to store Claude account token", {
      error: String(error),
    });
    return errorResponse("Failed to store the account token", 500);
  }
});
