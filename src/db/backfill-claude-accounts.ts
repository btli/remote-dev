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
 *      gets one, carrying the profile as its origin — UNLESS that profile's
 *      user already has ANY `claude_account` row (remote-dev-ifcl). Without
 *      the account, a project pinned to such a profile would have nothing to
 *      rotate or attribute limits to. Accounts are created token-less
 *      (`auth_healthy: false`) — the user completes "Add account" to attach a
 *      token.
 *
 *      Why the per-user skip: this backfill runs on EVERY deploy, and accounts
 *      added via "Add account" carry `profile_id` NULL — so a check keyed on
 *      `profile_id` alone can never be satisfied by them, and each deploy
 *      re-created the token-less "Not signed in" placeholders the user had
 *      just deleted. A user who has any account row at all has adopted the
 *      post-n4x4.6 account-first world and gains nothing from placeholders;
 *      the pass still covers the true migration case (users with
 *      claude-capable profiles and ZERO accounts).
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
import { eq, inArray, isNull } from "drizzle-orm";
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
  /**
   * Profiles skipped because their USER already has account rows
   * (remote-dev-ifcl): the user is past the migration, so no token-less
   * placeholder is created for their profiles.
   */
  profilesSkippedUserHasAccounts: number;
  /** `project_profile_link.account_id` values filled in from the primary profile. */
  projectLinksLinked: number;
}

export async function backfillClaudeAccounts(): Promise<ClaudeAccountBackfillResult> {
  const profiles = await db.query.agentProfiles.findMany({
    where: inArray(agentProfiles.provider, CLAUDE_CAPABLE_PROVIDERS),
    columns: { id: true, userId: true, name: true },
  });

  // ALL existing accounts, for two reads: profile-origin links (the pure "fill
  // the gaps" pass) and the per-user skip rule — a user with ANY pre-existing
  // account row (profile-linked or "Add account"-created with profile_id NULL)
  // gets no new placeholders (remote-dev-ifcl). The set is deliberately built
  // from PRE-existing rows only, so a true migration (user with zero accounts)
  // still backfills every one of their claude-capable profiles in this run.
  const existing = await db.query.claudeAccounts.findMany({
    columns: { id: true, profileId: true, userId: true },
  });
  const accountIdByProfile = new Map<string, string>();
  const usersWithAccounts = new Set<string>();
  for (const row of existing) {
    usersWithAccounts.add(row.userId);
    if (row.profileId && !accountIdByProfile.has(row.profileId)) {
      accountIdByProfile.set(row.profileId, row.id);
    }
  }

  let accountsCreated = 0;
  let accountsAlreadyPresent = 0;
  let profilesSkippedUserHasAccounts = 0;

  for (const profile of profiles) {
    if (accountIdByProfile.has(profile.id)) {
      accountsAlreadyPresent++;
      continue;
    }
    if (usersWithAccounts.has(profile.userId)) {
      profilesSkippedUserHasAccounts++;
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
    profilesSkippedUserHasAccounts,
    projectLinksLinked,
  };
  log.info("Claude account backfill complete", { ...result });
  return result;
}
