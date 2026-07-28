/**
 * GET /api/claude/usage - Claude Accounts dashboard payload.
 * [remote-dev-wb0q / remote-dev-n4x4.6]
 *
 * Returns every Claude ACCOUNT the user owns (not every claude-capable
 * profile), each with its alias / email / org / tier, auth health, serialized
 * usage-limit state, and the ids of any fallback pools it belongs to. This is
 * the single fetch that drives the Claude Accounts settings section.
 *
 * Tokens are never included — only `hasToken`.
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import {
  usageLimitStateRepository,
  profilePoolRepository,
} from "@/infrastructure/container";
import { listAccounts } from "@/services/claude-account-service";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";
import type { ClaudeUsageAccount } from "@/types/claude-limits";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId }) => {
  const accounts = await listAccounts(userId);
  const accountIds = accounts.map((a) => a.id);

  // Invert pool membership: accountId -> [poolId]. Pools are scoped to the
  // user, so the members we collect are only ever from the user's own pools.
  const pools = await profilePoolRepository.poolsForUser(userId);
  const poolIdsByAccount = new Map<string, string[]>();
  await Promise.all(
    pools.map(async (pool) => {
      const members = await profilePoolRepository.membersOfPool(pool.id);
      for (const member of members) {
        const list = poolIdsByAccount.get(member.accountId) ?? [];
        list.push(pool.id);
        poolIdsByAccount.set(member.accountId, list);
      }
    })
  );

  const limitStates =
    await usageLimitStateRepository.findManyByAccountIds(accountIds);

  const result: ClaudeUsageAccount[] = accounts.map((account) => ({
    ...account,
    limitState: serializeLimitState(limitStates.get(account.id) ?? null),
    pools: poolIdsByAccount.get(account.id) ?? [],
  }));

  return NextResponse.json({ accounts: result });
});
