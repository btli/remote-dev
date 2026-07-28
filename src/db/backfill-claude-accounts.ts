/**
 * Backfill Claude accounts after the profile→account decoupling.
 * [remote-dev-n4x4.6]
 *
 * Before this change, a Claude account was 1:1 with an `agent_profile`
 * (`claude_account.profile_id` was unique NOT NULL) and both the usage-limit
 * state and the fallback pools keyed on `profile_id`. Accounts are now
 * standalone rows, and both of those key on `claude_account.id`.
 *
 * `claude_account.profile_id` is RETAINED (nullable, non-unique) as an origin
 * breadcrumb, so existing account rows survive `db:push` untouched and this
 * backfill only has to fill the gaps:
 *
 *   1. Every claude-capable profile ("claude" or "all") that has no account row
 *      gets one, carrying the profile as its origin. Without this, a project
 *      pinned to such a profile would have nothing to rotate or attribute
 *      limits to. Accounts are created token-less (`auth_healthy: false`) — the
 *      user completes "Add account" to attach a token.
 *   2. Project links pinned to a primary PROFILE get their new `account_id`
 *      filled from that profile's origin account, so primary→pool selection
 *      keeps working without the compatibility bridge.
 *
 * Idempotent and safe to run repeatedly: every step is a "create only what is
 * missing" pass, and nothing is deleted or overwritten.
 *
 * NOT backfilled, deliberately:
 *   - `claude_usage_limit_state` rows. Its primary key changed from `profile_id`
 *     to `account_id`, so `db:push` rebuilds the table and the old rows are
 *     gone before this code can see them. They are ephemeral observations that
 *     the reactive detector / poller re-derive within one 5h window, so the
 *     cost is one window of "unknown" status, not lost configuration.
 *   - `claude_profile_pool_member` rows, for the same reason (the member column
 *     changed identity). Pool MEMBERSHIP is user configuration, so this is a
 *     real (one-time) loss — see IMPLEMENTATION.md. Pools themselves survive;
 *     members must be re-added once, now as accounts.
 *
 * Run with: bun run db:backfill-claude-accounts
 */

import { db } from "./index";
import { agentProfiles, claudeAccounts, projectProfileLinks } from "./schema";
import type { AgentProvider } from "@/types/agent";
import { eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("BackfillClaudeAccounts");

/** Providers whose profiles can run Claude Code (and so carry an account). */
const CLAUDE_CAPABLE_PROVIDERS: AgentProvider[] = ["claude", "all"];

export interface ClaudeAccountBackfillResult {
  /** Claude-capable profiles considered. */
  profilesScanned: number;
  /** Accounts newly created for profiles that had none. */
  accountsCreated: number;
  /** Profiles that already had an account (skipped). */
  accountsAlreadyPresent: number;
  /** `project_profile_link.account_id` values filled in from the primary profile. */
  projectLinksLinked: number;
}

export async function backfillClaudeAccounts(): Promise<ClaudeAccountBackfillResult> {
  const profiles = await db.query.agentProfiles.findMany({
    where: inArray(agentProfiles.provider, CLAUDE_CAPABLE_PROVIDERS),
    columns: { id: true, userId: true, name: true },
  });

  // Existing origin links, so the pass is a pure "fill the gaps".
  const existing = await db.query.claudeAccounts.findMany({
    where: isNotNull(claudeAccounts.profileId),
    columns: { id: true, profileId: true },
  });
  const accountIdByProfile = new Map<string, string>();
  for (const row of existing) {
    if (row.profileId && !accountIdByProfile.has(row.profileId)) {
      accountIdByProfile.set(row.profileId, row.id);
    }
  }

  let accountsCreated = 0;
  let accountsAlreadyPresent = 0;

  for (const profile of profiles) {
    if (accountIdByProfile.has(profile.id)) {
      accountsAlreadyPresent++;
      continue;
    }
    const id = crypto.randomUUID();
    await db.insert(claudeAccounts).values({
      id,
      userId: profile.userId,
      profileId: profile.id,
      // Label the migrated account after its origin profile so it is
      // recognizable in the accounts list before the user renames it.
      alias: profile.name,
      accountKind: "subscription",
      // Token-less until the user runs "Add account": we cannot recover a
      // credential the CLI put in the macOS Keychain.
      authHealthy: false,
    });
    accountIdByProfile.set(profile.id, id);
    accountsCreated++;
  }

  // Fill `project_profile_link.account_id` from the primary profile's account.
  const links = await db.query.projectProfileLinks.findMany({
    where: isNull(projectProfileLinks.accountId),
    columns: { projectId: true, profileId: true },
  });

  let projectLinksLinked = 0;
  for (const link of links) {
    if (!link.profileId) continue;
    const accountId = accountIdByProfile.get(link.profileId);
    if (!accountId) continue;
    await db
      .update(projectProfileLinks)
      .set({ accountId })
      .where(eq(projectProfileLinks.projectId, link.projectId));
    projectLinksLinked++;
  }

  const result: ClaudeAccountBackfillResult = {
    profilesScanned: profiles.length,
    accountsCreated,
    accountsAlreadyPresent,
    projectLinksLinked,
  };
  log.info("Claude account backfill complete", { ...result });
  return result;
}
