import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { AgentProvider } from "@/types/agent";
import { usageLimitStateRepository } from "@/infrastructure/container";
import {
  serializeLimitState,
  getClaudeAccountInfoMany,
  defaultClaudeAccountInfo,
  isClaudeCapable,
} from "@/app/api/_lib/serialize-limit-state";

const VALID_PROVIDERS: AgentProvider[] = ["claude", "codex", "gemini", "opencode", "all"];

/**
 * GET /api/profiles - Get all profiles for the current user.
 *
 * Each profile is augmented (additively — existing fields are untouched) with:
 * - `accountKind`: from `claude_account`, defaulting to "subscription" for
 *   claude-capable profiles without a row (non-claude profiles also default,
 *   but their limit state is always the unknown default).
 * - `claudeAccountId`: the profile's origin Claude account, or null.
 * - `limitState`: the serialized Claude usage-limit block for that account
 *   (available/unknown default when there is none). See
 *   `_lib/serialize-limit-state`.
 */
export const GET = withAuth(async (_request, { userId }) => {
  const [profiles, folderLinks] = await Promise.all([
    AgentProfileService.getProfiles(userId),
    AgentProfileService.getFolderProfileLinks(userId),
  ]);

  // Batch-load limit state + account info for claude-capable profiles only;
  // others get the defaults without a query.
  const claudeProfileIds = profiles
    .filter((p) => isClaudeCapable(p.provider))
    .map((p) => p.id);

  // [remote-dev-n4x4.6] Limit state is keyed on the ACCOUNT now, so resolve
  // each claude-capable profile's origin account first and look the state up by
  // that. A profile with no account keeps the unknown default.
  const accountInfo = await getClaudeAccountInfoMany(claudeProfileIds);
  const accountIds = [...accountInfo.values()]
    .map((a) => a.accountId)
    .filter((id): id is string => id !== null);
  const limitStates =
    await usageLimitStateRepository.findManyByAccountIds(accountIds);

  const augmented = profiles.map((profile) => {
    const account = accountInfo.get(profile.id) ?? defaultClaudeAccountInfo();
    return {
      ...profile,
      accountKind: account.accountKind,
      claudeAccountId: account.accountId,
      limitState: serializeLimitState(
        account.accountId ? (limitStates.get(account.accountId) ?? null) : null
      ),
    };
  });

  return NextResponse.json({ profiles: augmented, folderLinks });
});

/**
 * POST /api/profiles - Create a new agent profile
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    name: string;
    description?: string;
    provider: AgentProvider;
    isDefault?: boolean;
  }>(request);

  if ("error" in result) {
    return result.error;
  }

  const { name, description, provider, isDefault } = result.data;

  // Validate required fields
  if (!name || typeof name !== "string") {
    return errorResponse("Name is required", 400);
  }

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return errorResponse(
      `Provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400
    );
  }

  const profile = await AgentProfileService.createProfile(userId, {
    name,
    description: description ?? undefined,
    provider,
    isDefault: isDefault ?? false,
  });

  return NextResponse.json(profile, { status: 201 });
});
