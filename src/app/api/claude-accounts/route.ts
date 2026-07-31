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
 *         token encrypted and reads identity via `claude auth status --json`.
 *         Re-posting a token for a known email UPDATES that account in place.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  listAccounts,
  saveAccountToken,
  looksLikeOAuthToken,
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

  const alias = result.data.alias?.trim() || null;

  try {
    const { account, identity, updated } = await saveAccountToken({
      userId,
      token,
      alias,
    });
    // The token itself is never logged — only whether the probe recognized it.
    log.info("Stored Claude account token", {
      accountId: account.id,
      updated,
      loggedIn: identity.loggedIn,
    });
    return NextResponse.json(
      { account, loggedIn: identity.loggedIn, updated },
      { status: updated ? 200 : 201 }
    );
  } catch (error) {
    log.error("Failed to store Claude account token", {
      error: String(error),
    });
    return errorResponse("Failed to store the account token", 500);
  }
});
