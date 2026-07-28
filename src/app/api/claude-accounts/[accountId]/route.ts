/**
 * GET | PATCH | DELETE /api/claude-accounts/[accountId] - one Claude account.
 * [remote-dev-n4x4.6]
 *
 * Every verb is ownership-scoped: an account belonging to another user is
 * indistinguishable from a missing one (404), so nothing leaks.
 *
 * GET    -> the token-free account view.
 * PATCH  -> `{ alias?, accountKind? }`. Re-pasting a token goes through
 *           `POST /api/claude-accounts` instead.
 * DELETE -> remove the account. Its usage-limit state + pool memberships
 *           cascade; project links that pinned it are cleared.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  getAccount,
  updateAccount,
  deleteAccount,
} from "@/services/claude-account-service";
import type { ClaudeAccountKind } from "@/types/claude-limits";

export const dynamic = "force-dynamic";

const VALID_KINDS: ClaudeAccountKind[] = ["subscription", "api_key"];

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const accountId = params?.accountId;
  if (!accountId) return errorResponse("Account ID is required", 400);

  const account = await getAccount(accountId, userId);
  if (!account) return errorResponse("Account not found", 404);
  return NextResponse.json({ account });
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const accountId = params?.accountId;
  if (!accountId) return errorResponse("Account ID is required", 400);

  const result = await parseJsonBody<{
    alias?: unknown;
    accountKind?: unknown;
  }>(request);
  if ("error" in result) return result.error;

  // Runtime-validate: the body is only known to be JSON, so guard the types
  // before any string method runs (otherwise `{"alias": 12}` 500s).
  const { accountKind } = result.data;
  if (
    accountKind !== undefined &&
    !VALID_KINDS.includes(accountKind as ClaudeAccountKind)
  ) {
    return errorResponse(
      `accountKind must be one of: ${VALID_KINDS.join(", ")}`,
      400
    );
  }
  if (
    result.data.alias !== undefined &&
    result.data.alias !== null &&
    typeof result.data.alias !== "string"
  ) {
    return errorResponse("alias must be a string or null", 400);
  }

  const alias =
    result.data.alias === undefined
      ? undefined
      : result.data.alias === null
        ? null
        : (result.data.alias as string).trim() || null;

  const account = await updateAccount(accountId, userId, {
    ...(alias !== undefined ? { alias } : {}),
    ...(accountKind ? { accountKind: accountKind as ClaudeAccountKind } : {}),
  });
  if (!account) return errorResponse("Account not found", 404);
  return NextResponse.json({ account });
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const accountId = params?.accountId;
  if (!accountId) return errorResponse("Account ID is required", 400);

  const deleted = await deleteAccount(accountId, userId);
  if (!deleted) return errorResponse("Account not found", 404);
  return new NextResponse(null, { status: 204 });
});
