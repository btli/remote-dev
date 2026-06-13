/**
 * PriorityProfileSelectionPolicy - The shipped ProfileSelectionPolicy.
 *
 * Resolves a project's Claude profile from its primary link + a fallback pool,
 * using the pure RotationPolicy over the AVAILABLE candidates.
 *
 * Candidate gathering:
 *   - primary  = `project_profile_link.profileId` (most preferred).
 *   - poolId   = `project_profile_link.poolId`, else the inherited
 *                `nodePreferences.claudeProfilePoolId` (project→group chain).
 *   - members  = pool members (each with its rotation priority).
 *   - The candidate set is the pool members UNION the primary, with the
 *     primary pinned to the most-preferred slot (priority < every member).
 *
 * Semantics:
 *   - `selectForProject`: the selected AVAILABLE candidate by priority. If a
 *     pool exists but ALL candidates are limited, return a best-effort
 *     candidate (primary, else lowest-priority member) — never block a launch,
 *     never throw. Nothing configured (no primary, no pool) → null.
 *   - `selectNextAvailable`: same gathering but EXCLUDING `currentProfileId`;
 *     first AVAILABLE by priority, else null ("all limited").
 *
 * The two DB reads (project link, inherited pool) are injected as thin readers
 * so the policy is unit-testable with fakes (no DB).
 */

import { RotationPolicy } from "@/domain/value-objects/RotationPolicy";
import type { RotationCandidate } from "@/domain/value-objects/RotationPolicy";
import { LimitState } from "@/domain/value-objects/LimitState";
import type {
  ProfileSelectionPolicy,
} from "@/application/ports/ProfileSelectionPolicy";
import type {
  ProfilePoolRepository,
  PoolEntry,
} from "@/application/ports/ProfilePoolRepository";
import type { UsageLimitStateRepository } from "@/application/ports/UsageLimitStateRepository";

/** The primary + pool wiring for a project, as read from its link row. */
export interface ProjectProfileLink {
  profileId: string | null;
  poolId: string | null;
}

/** Thin reader of `project_profile_link` (profileId + poolId). */
export type ProjectLinkReader = (
  projectId: string
) => Promise<ProjectProfileLink | null>;

/** Thin reader of the inherited `nodePreferences.claudeProfilePoolId`. */
export type InheritedPoolReader = (
  projectId: string,
  userId: string
) => Promise<string | null>;

/**
 * Priority pinned to the primary profile so it always sorts ahead of pool
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
    private readonly readInheritedPoolId: InheritedPoolReader
  ) {}

  async selectForProject(
    projectId: string,
    userId: string,
    now: Date
  ): Promise<string | null> {
    const { candidates, hasPool } = await this.gatherCandidates(
      projectId,
      userId
    );
    if (candidates.length === 0) return null; // nothing configured

    const selected = RotationPolicy.select(candidates, now);
    if (selected) return selected;

    // Everything is limited. Don't block the launch: fall back to a best-effort
    // candidate (the primary, else the lowest-priority member).
    if (!hasPool && candidates.length === 0) return null;
    return bestEffort(candidates);
  }

  async selectNextAvailable(
    currentProfileId: string,
    projectId: string,
    userId: string,
    now: Date
  ): Promise<string | null> {
    const { candidates } = await this.gatherCandidates(projectId, userId);
    const alternates = candidates.filter(
      (c) => c.profileId !== currentProfileId
    );
    // First available by ascending priority; null when none.
    return RotationPolicy.select(alternates, now);
  }

  /**
   * Build the ordered candidate set for a project: the primary (pinned first)
   * plus every pool member, each paired with its current limit state. De-dupes
   * by profileId, keeping the most-preferred (lowest-priority) entry.
   */
  private async gatherCandidates(
    projectId: string,
    userId: string
  ): Promise<{ candidates: RotationCandidate[]; hasPool: boolean }> {
    const link = await this.readProjectLink(projectId);
    const primaryId = link?.profileId ?? null;

    // Pool comes from the link first, else the inherited preference pool.
    const poolId =
      link?.poolId ?? (await this.readInheritedPoolId(projectId, userId));

    const members: PoolEntry[] = poolId
      ? await this.poolRepository.membersOfPool(poolId)
      : [];

    // Lowest priority wins on de-dupe; the primary is pinned ahead of all.
    const byProfile = new Map<string, number>();
    for (const m of members) {
      const existing = byProfile.get(m.profileId);
      if (existing === undefined || m.priority < existing) {
        byProfile.set(m.profileId, m.priority);
      }
    }
    if (primaryId) {
      byProfile.set(primaryId, PRIMARY_PRIORITY);
    }

    const profileIds = [...byProfile.keys()];
    if (profileIds.length === 0) {
      return { candidates: [], hasPool: poolId !== null };
    }

    const states = await this.stateRepository.findManyByProfileIds(profileIds);

    const candidates: RotationCandidate[] = profileIds.map((profileId) => ({
      profileId,
      priority: byProfile.get(profileId) as number,
      // No recorded state → treat as available (never observed limited).
      limitState: states.get(profileId) ?? LimitState.available(profileId),
    }));

    // Sort by priority so best-effort + selection are order-stable.
    candidates.sort((a, b) => a.priority - b.priority);

    return { candidates, hasPool: poolId !== null };
  }
}

/** The most-preferred candidate (already priority-sorted ascending). */
function bestEffort(candidates: RotationCandidate[]): string | null {
  return candidates.length > 0 ? candidates[0].profileId : null;
}
