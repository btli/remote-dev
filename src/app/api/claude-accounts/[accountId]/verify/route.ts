/**
 * POST /api/claude-accounts/[accountId]/verify - re-read an account's identity.
 * [remote-dev-n4x4.8]
 *
 * Runs `claude auth status --json` UNDER the account's env (its decrypted
 * OAuth token) and refreshes email / org / tier / auth-method / health.
 *
 * This REPLACES the old "Sync" button, which read
 * `<profileConfigDir>/.claude/.credentials.json` — a file that never exists on
 * macOS (the CLI writes credentials to the Keychain, under a service name
 * derived from `CLAUDE_CONFIG_DIR`). That path could not succeed, so the button
 * was silently dead. Identity now comes from the CLI, never from credential
 * files.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { verifyAccount } from "@/services/claude-account-service";
import { requireAccountId } from "@/app/api/_lib/claude-account-params";

export const dynamic = "force-dynamic";

export const POST = withApiAuth(async (_request, { userId, params }) => {
  const id = requireAccountId(params);
  if ("error" in id) return id.error;

  const result = await verifyAccount(id.accountId, userId);
  if (!result) return errorResponse("Account not found", 404);

  return NextResponse.json({
    account: result.account,
    loggedIn: result.identity.loggedIn,
    authMethod: result.identity.authMethod,
  });
});
