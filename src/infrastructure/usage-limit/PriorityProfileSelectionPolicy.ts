/**
 * PriorityProfileSelectionPolicy - The shipped ProfileSelectionPolicy.
 *
 * Resolves a project's Claude ACCOUNT from its primary link + a fallback pool,
 * using the pure RotationPolicy over the AVAILABLE candidates.
 * [remote-dev-n4x4.6] — the unit of rotation is an account, not a profile.
 *
 * Candidate gathering:
 *   - primary  = `project_profile_link.accountId`, else the account whose
 *                *origin* profile is `project_profile_link.profileId` (the
 *                pre-n4x4.6 layout, resolved through `readAccountForProfile`).
 *   - poolId   = `project_profile_link.poolId`, else the inherited
 *                `nodePreferences.claudeProfilePoolId` (project→group chain).
 *   - members  = pool members (each an account with its rotation priority).
 *   - The candidate set is the pool members UNION the primary, with the
 *     primary pinned to the most-preferred slot (priority < every member).
 *
 * Semantics:
 *   - `selectForProject`: the selected AVAILABLE candidate by priority. When
 *     NOTHING is currently available — whether that's a limited primary with no
 *     pool, or every pool member limited — fall through to a best-effort
 *     candidate (the primary if set, else the lowest-priority member) so a
 *     launch is never blocked and nothing is thrown. `null` is returned ONLY
 *     when nothing is configured (no primary AND no pool).
 *   - `selectNextAvailable`: same gathering but EXCLUDING `currentAccountId`;
 *     first AVAILABLE by priority, else null ("all limited").
 *
 * The DB reads (project link, inherited pool, account origin profiles) are
 * injected as thin readers so the policy is unit-testable with fakes (no DB).
 */

import { RotationPolicy } from "@/domain/value-objects/RotationPolicy";
import type { RotationCandidate } from "@/domain/value-objects/RotationPolicy";
import { LimitState } from "@/domain/value-objects/LimitState";
import type {
  ProfileSelectionPolicy,
  SelectedAccount,
} from "@/application/ports/ProfileSelectionPolicy";
import type {
  ProfilePoolRepository,
  PoolEntry,
} from "@/application/ports/ProfilePoolRepository";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";

/** The primary + pool wiring for a project, as read from its link row. */
export interface ProjectProfileLink {
  profileId: string | null;
  accountId: string | null;
  poolId: string | null;
}

/** Thin reader of `project_profile_link` (profileId + accountId + poolId). */
export type ProjectLinkReader = (
  projectId: string
) => Promise<ProjectProfileLink | null>;

/** Thin reader of the inherited `nodePreferences.claudeProfilePoolId`. */
export type InheritedPoolReader = (
  projectId: string,
  userId: string
) => Promise<string | null>;

/**
 * Resolve the account whose *origin* profile is `profileId` — the compatibility
 * bridge for projects still pinned to a pre-n4x4.6 primary profile. Returns
 * null when that profile never had a Claude account.
 */
export type AccountForProfileReader = (
  profileId: string,
  userId: string
) => Promise<string | null>;

/** Reverse lookup: an account's origin profile id (null when standalone). */
export type ProfileForAccountReader = (
  accountIds: string[]
) => Promise<Map<string, string | null>>;

/**
 * Priority pinned to the primary account so it always sorts ahead of pool
 * members. Pool member priorities default to 0 and grow; a large finite
 * negative keeps the primary first even if a member also uses a negative
 * priority. Must stay FINITE — RotationPolicy rejects non-finite priorities.
 */
const PRIMARY_PRIORITY = Number.MIN_SAFE_INTEGER;

export class PriorityProfileSelectionPolicy implements ProfileSelectionPolicy {
  constructor(
    private readonly poolRepository: ProfilePoolRepository,
    private readonly stateRepository: UsageLimitStateRepository,
    private readonly readProjectLink: ProjectLinkReader,
    private readonly readInheritedPoolId: InheritedPoolReader,
    private readonly readAccountForProfile: AccountForProfileReader,
    private readonly readProfilesForAccounts: ProfileForAccountReader
  ) {}

  async selectForProject(
    projectId: string,
    userId: string,
    now: Date
  ): Promise<SelectedAccount | null> {
    const candidates = await this.gatherCandidates(projectId, userId);
    if (candidates.length === 0) return null; // nothing configured

    const selected = RotationPolicy.select(candidates, now);
    // Nothing is available right now (e.g. the primary is limited and there is
    // no pool, or every pool member is limited). Don't block the launch: fall
    // through to a best-effort candidate (the primary if set, else the
    // lowest-priority member). `null` is only returned above, when nothing is
    // configured at all.
    const accountId = selected ?? bestEffort(candidates);
    if (!accountId) return null;

    return this.withOriginProfile(accountId);
  }

  async selectNextAvailable(
    currentAccountId: string,
    projectId: string,
    userId: string,
    now: Date
  ): Promise<SelectedAccount | null> {
    const candidates = await this.gatherCandidates(projectId, userId);
    const alternates = candidates.filter((c) => c.accountId !== currentAccountId);
    // First available by ascending priority; null when none.
    const accountId = RotationPolicy.select(alternates, now);
    if (!accountId) return null;
    return this.withOriginProfile(accountId);
  }

  /** Pair a chosen accountId with its origin profile (null when standalone). */
  private async withOriginProfile(accountId: string): Promise<SelectedAccount> {
    const profiles = await this.readProfilesForAccounts([accountId]);
    return { accountId, profileId: profiles.get(accountId) ?? null };
  }

  /**
   * Build the ordered candidate set for a project: the primary (pinned first)
   * plus every pool member, each paired with its current limit state. De-dupes
   * by accountId, keeping the most-preferred (lowest-priority) entry.
   */
  private async gatherCandidates(
    projectId: string,
    userId: string
  ): Promise<RotationCandidate[]> {
    const link = await this.readProjectLink(projectId);

    // Primary: the explicit account link wins; otherwise bridge the legacy
    // profile link through that profile's origin account.
    let primaryId = link?.accountId ?? null;
    if (!primaryId && link?.profileId) {
      primaryId = await this.readAccountForProfile(link.profileId, userId);
    }

    // Pool comes from the link first, else the inherited preference pool.
    const poolId =
      link?.poolId ?? (await this.readInheritedPoolId(projectId, userId));

    const members: PoolEntry[] = poolId
      ? await this.poolRepository.membersOfPool(poolId)
      : [];

    // Lowest priority wins on de-dupe; the primary is pinned ahead of all.
    const byAccount = new Map<string, number>();
    for (const m of members) {
      const existing = byAccount.get(m.accountId);
      if (existing === undefined || m.priority < existing) {
        byAccount.set(m.accountId, m.priority);
      }
    }
    if (primaryId) {
      byAccount.set(primaryId, PRIMARY_PRIORITY);
    }

    const accountIds = [...byAccount.keys()];
    if (accountIds.length === 0) {
      return [];
    }

    const states = await this.stateRepository.findManyByAccountIds(accountIds);

    const candidates: RotationCandidate[] = accountIds.map((accountId) => ({
      accountId,
      priority: byAccount.get(accountId) as number,
      // No recorded state → treat as available (never observed limited).
      limitState: states.get(accountId) ?? LimitState.available(accountId),
    }));

    // Sort by priority so best-effort + selection are order-stable.
    candidates.sort((a, b) => a.priority - b.priority);

    return candidates;
  }
}

/** The most-preferred candidate (already priority-sorted ascending). */
function bestEffort(candidates: RotationCandidate[]): string | null {
  return candidates.length > 0 ? candidates[0].accountId : null;
}
