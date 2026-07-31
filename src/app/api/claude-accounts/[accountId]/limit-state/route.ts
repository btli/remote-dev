/**
 * GET | PATCH /api/claude-accounts/[accountId]/limit-state - Claude usage limit
 * for one ACCOUNT. [remote-dev-wb0q / remote-dev-n4x4.6]
 *
 * (Replaces `/api/profiles/[id]/limit-state`: a usage limit belongs to the
 * subscription, not to the config dir a session happened to run under.)
 *
 * GET returns the account's serialized limit state (available/unknown default
 * when none recorded). PATCH `{ status: "available" }` is a manual override
 * that clears a limit: it calls TrackUsageLimitUseCase with `source: "manual"`,
 * which bypasses the staleness guard (a user action is authoritative).
 *
 * Both verbs enforce ownership: the account must belong to the caller.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getAccount } from "@/services/claude-account-service";
import {
  usageLimitStateRepository,
  trackUsageLimitUseCase,
} from "@/infrastructure/container";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";
import { requireAccountId } from "@/app/api/_lib/claude-account-params";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = requireAccountId(params);
  if ("error" in id) return id.error;

  const account = await getAccount(id.accountId, userId);
  if (!account) return errorResponse("Account not found", 404);

  const state = await usageLimitStateRepository.findByAccountId(id.accountId);
  return NextResponse.json(serializeLimitState(state));
});

/**
 * PATCH - manual override. Body: `{ status: "available" }`. Marks the account
 * available again (clears a limit). Any other status is rejected — limiting an
 * account is a detection concern, not a manual one.
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = requireAccountId(params);
  if ("error" in id) return id.error;
  const { accountId } = id;

  const account = await getAccount(accountId, userId);
  if (!account) return errorResponse("Account not found", 404);

  const result = await parseJsonBody<{ status?: string }>(request);
  if ("error" in result) return result.error;

  const { status } = result.data;
  if (status !== "available") {
    return errorResponse(
      'Only { status: "available" } is supported (manual override clears a limit)',
      400,
      "INVALID_STATUS"
    );
  }

  // Manual source bypasses the staleness guard in the use-case.
  const { state } = await trackUsageLimitUseCase.execute({
    accountId,
    userId,
    source: "manual",
    isLimited: false,
  });

  return NextResponse.json(serializeLimitState(state));
});
