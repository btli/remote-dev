/**
 * GET /api/claude/usage - cswap-style dashboard payload. [remote-dev-wb0q]
 *
 * Returns every claude-capable profile the user owns, each with its account
 * kind + display identity (from `claude_account`, defaulted when absent), its
 * serialized limit state, and the ids of any pools it belongs to. This is the
 * single fetch that drives the Claude Accounts dashboard (Wave D).
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import {
  usageLimitStateRepository,
  profilePoolRepository,
} from "@/infrastructure/container";
import * as AgentProfileService from "@/services/agent-profile-service";
import {
  serializeLimitState,
  getClaudeAccountInfoMany,
  defaultClaudeAccountInfo,
  isClaudeCapable,
  type SerializedLimitState,
} from "@/app/api/_lib/serialize-limit-state";
import type { ClaudeAccountKind } from "@/types/claude-limits";

export const dynamic = "force-dynamic";

interface ClaudeUsageProfile {
  id: string;
  name: string;
  accountKind: ClaudeAccountKind;
  emailAddress: string | null;
  organizationName: string | null;
  limitState: SerializedLimitState;
  /** Ids of the user's pools this profile is a member of. */
  pools: string[];
}

export const GET = withApiAuth(async (_request, { userId }) => {
  const profiles = await AgentProfileService.getProfiles(userId);
  const claudeProfiles = profiles.filter((p) => isClaudeCapable(p.provider));
  const claudeIds = claudeProfiles.map((p) => p.id);

  // Invert pool membership: profileId -> [poolId]. Pools are scoped to the
  // user, so members we collect are only ever from the user's own pools.
  const pools = await profilePoolRepository.poolsForUser(userId);
  const poolIdsByProfile = new Map<string, string[]>();
  await Promise.all(
    pools.map(async (pool) => {
      const members = await profilePoolRepository.membersOfPool(pool.id);
      for (const member of members) {
        const list = poolIdsByProfile.get(member.profileId) ?? [];
        list.push(pool.id);
        poolIdsByProfile.set(member.profileId, list);
      }
    })
  );

  const [limitStates, accountInfo] = await Promise.all([
    usageLimitStateRepository.findManyByProfileIds(claudeIds),
    getClaudeAccountInfoMany(claudeIds),
  ]);

  const result: ClaudeUsageProfile[] = claudeProfiles.map((profile) => {
    const account = accountInfo.get(profile.id) ?? defaultClaudeAccountInfo();
    return {
      id: profile.id,
      name: profile.name,
      accountKind: account.accountKind,
      emailAddress: account.emailAddress,
      organizationName: account.organizationName,
      limitState: serializeLimitState(limitStates.get(profile.id) ?? null),
      pools: poolIdsByProfile.get(profile.id) ?? [],
    };
  });

  return NextResponse.json({ profiles: result });
});
