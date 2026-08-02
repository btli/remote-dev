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
 * Model awareness [remote-dev-n4x4.3]:
 *   - Selection answers "is this account available FOR MODEL M", not just "is
 *     this account available". An account is unavailable for M when it has a
 *     model-scoped usage window (`scopeModel` non-null) matching M that is
 *     `critical` or at/over 100%% and has not yet reset — even while the
 *     ACCOUNT-level status still reads "allowed". That is the real-world case:
 *     a per-model weekly window taps out long before the subscription does.
 *   - It FAILS OPEN by construction. No model requested, no stored windows, an
 *     unrecognizable model name, or an expired window → behaviour is
 *     byte-for-byte what it was before this change. A bug here would degrade
 *     rotation for everyone, so nothing may narrow availability by accident.
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
import type {
  UsageLimitWindow,
  UsageLimitWindowRepository,
} from "@/application/ports/UsageLimitWindowRepository";
import { UsageWindow } from "@/domain/value-objects/UsageWindow";
import {
  claudeModelIdentityMatches,
  resolveClaudeModelFamily,
} from "@/domain/value-objects/ClaudeModelIdentity";
import { createLogger } from "@/lib/logger";

const log = createLogger("ProfileSelectionPolicy");

/**
 * The ONLY window kind allowed to block a model. [review G5]
 *
 * Matching any model-scoped kind was considered and rejected. `kind` IS an open
 * string set, but consuming an unknown future kind as blocking means a new
 * diagnostic / daily / surface-scoped row that upstream marks critical would
 * silently change account selection with no authorization — a different policy
 * being applied to a weekly rotation decision. Failing open beats future-proof
 * here. New kinds are logged (never acted on) so we learn about them.
 */
const BLOCKING_KIND = "weekly_scoped";

/**
 * How long a stored window stays trustworthy. The sweep polls every ~10
 * minutes; six intervals tolerates transient endpoint failures without letting
 * a row that can only be cleared by a *successful* poll (revoked token, decrypt
 * failure, kill switch flipped) block a model indefinitely. [review G3]
 */
const MAX_WINDOW_AGE_MS = 60 * 60 * 1000;

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
    private readonly readProfilesForAccounts: ProfileForAccountReader,
    /**
     * Per-model window store. Optional: without it the policy is exactly the
     * pre-n4x4.3 account-level policy, which is also what happens when no model
     * is requested. [remote-dev-n4x4.3]
     */
    private readonly windowRepository?: UsageLimitWindowRepository
  ) {}

  async selectForProject(
    projectId: string,
    userId: string,
    now: Date,
    requestedModel?: string | null
  ): Promise<SelectedAccount | null> {
    const candidates = await this.gatherCandidates(
      projectId,
      userId,
      now,
      requestedModel
    );
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
    now: Date,
    requestedModel?: string | null
  ): Promise<SelectedAccount | null> {
    const candidates = await this.gatherCandidates(
      projectId,
      userId,
      now,
      requestedModel
    );
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
    userId: string,
    now: Date,
    requestedModel?: string | null
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
    const modelBlocks = await this.blockingWindowsForModel(
      accountIds,
      requestedModel,
      now
    );

    const candidates: RotationCandidate[] = accountIds.map((accountId) => {
      // No recorded state → treat as available (never observed limited).
      const accountState =
        states.get(accountId) ?? LimitState.available(accountId);
      const blocking = modelBlocks.get(accountId);
      return {
        accountId,
        priority: byAccount.get(accountId) as number,
        limitState: blocking
          ? limitedForModel(accountId, accountState, blocking)
          : accountState,
      };
    });

    // Sort by priority so best-effort + selection are order-stable.
    candidates.sort((a, b) => a.priority - b.priority);

    return candidates;
  }

  /**
   * Which of `accountIds` are exhausted FOR `requestedModel`, and by which
   * window. [remote-dev-n4x4.3]
   *
   * EVERY exit from this function yields "not blocked". That is the invariant:
   * no window repository, no model, an unrecognized model, a repository error,
   * a stale row, a missing/elapsed reset, an inactive row, or a non-weekly kind
   * all leave availability exactly as the account-level state reports it.
   */
  private async blockingWindowsForModel(
    accountIds: string[],
    requestedModel: string | null | undefined,
    now: Date
  ): Promise<Map<string, UsageLimitWindow>> {
    const blocked = new Map<string, UsageLimitWindow>();
    if (!this.windowRepository) return blocked;
    if (typeof requestedModel !== "string" || requestedModel.trim() === "") {
      return blocked;
    }

    // An unrecognized model is never compared against a scoped row, so it can
    // never block. Logged because this is the signal that a new family shipped
    // and KNOWN_FAMILIES needs an entry. [review G4]
    if (resolveClaudeModelFamily(requestedModel) === null) {
      log.debug("Unrecognized requested model; skipping model-aware selection", {
        requestedModel,
      });
      return blocked;
    }

    // A repository failure must NOT propagate. It used to: the throw travelled
    // through gatherCandidates → selectForProject, session-service caught it
    // and "proceeded without a profile", so the session launched with no
    // account and no injected token — on ambient credentials. That fired only
    // for sessions passing --model, i.e. exactly the premium sessions this
    // feature exists to protect. [review G2]
    let byAccount: Map<string, UsageLimitWindow[]>;
    try {
      byAccount = await this.windowRepository.findManyByAccountIds(accountIds);
    } catch (error) {
      log.warn("Usage-window read failed; falling back to account-level selection", {
        error: String(error),
      });
      return blocked;
    }

    for (const [accountId, windows] of byAccount) {
      for (const window of windows) {
        // Account-level window: already reflected in the rollup state.
        if (window.scopeModel === null) continue;
        if (!claudeModelIdentityMatches(requestedModel, window.scopeModel)) {
          continue;
        }
        if (!isExhausted(window)) continue;

        // Only `weekly_scoped` may block; anything else is observed, logged,
        // and ignored. [review G5]
        if (window.kind.trim().toLowerCase() !== BLOCKING_KIND) {
          log.debug("Ignoring exhausted model-scoped window of an unknown kind", {
            accountId,
            kind: window.kind,
            scopeModel: window.scopeModel,
          });
          continue;
        }

        // `is_active` is the endpoint's own "this is the binding constraint"
        // flag; in the live capture the exhausted Fable window carried it. An
        // exhausted-but-inactive row is a weaker claim, so it is observed and
        // ignored rather than acted on — under-blocking is the safe direction.
        if (!window.isActive) {
          log.debug("Ignoring exhausted model-scoped window that is not active", {
            accountId,
            scopeModel: window.scopeModel,
          });
          continue;
        }

        // A row can only be cleared by a later SUCCESSFUL poll, so an
        // unrefreshed one must expire on its own or it pins the account off
        // this model forever. [review G3]
        if (isStale(window, now)) {
          log.debug("Ignoring stale model-scoped window", {
            accountId,
            scopeModel: window.scopeModel,
            observedAt: window.observedAt?.toISOString(),
          });
          continue;
        }

        // A blocking row must carry a valid FUTURE reset. A null reset would
        // make `LimitState.isAvailableNow` treat the account as permanently
        // unavailable for this model; an elapsed one has already rolled over.
        if (
          !(window.resetsAt instanceof Date) ||
          Number.isNaN(window.resetsAt.getTime()) ||
          window.resetsAt.getTime() <= now.getTime()
        ) {
          continue;
        }

        blocked.set(accountId, window);
        break;
      }
    }

    return blocked;
  }
}

/**
 * Whether a stored window is too old to trust. A row with no `observedAt`
 * (pre-existing data written before the column landed) is treated as stale.
 */
function isStale(window: UsageLimitWindow, now: Date): boolean {
  if (!(window.observedAt instanceof Date)) return true;
  const age = now.getTime() - window.observedAt.getTime();
  return age > MAX_WINDOW_AGE_MS;
}

/**
 * Whether a model-scoped window leaves no headroom. `critical` is the
 * endpoint's own verdict; `percent >= 100` catches the case where severity is
 * absent or spelled in a way we do not recognize.
 */
function isExhausted(window: UsageLimitWindow): boolean {
  if (typeof window.severity === "string") {
    if (window.severity.trim().toLowerCase() === "critical") return true;
  }
  return typeof window.percent === "number" && window.percent >= 100;
}

/**
 * A state that reports the account as unavailable *because* a model-scoped
 * window is exhausted, carrying that window's reset so the account frees itself
 * again once the window rolls over (mirroring how account-level limits expire).
 *
 * The source and lastCheckedAt are inherited from the account-level state so
 * the derived state stays attributable to the observation it came from.
 */
function limitedForModel(
  accountId: string,
  accountState: LimitState,
  blocking: UsageLimitWindow
): LimitState {
  return LimitState.limited(accountId, {
    // Duration comes from the row's own group rather than being hardcoded, so
    // the derived state describes the window that actually blocked. The reset
    // is what makes this expire instead of pinning the account forever — the
    // caller guarantees it is present and in the future.
    windows: [
      UsageWindow.create(durationForWindow(blocking), 100, blocking.resetsAt),
    ],
    source: accountState.getSource(),
    lastCheckedAt: accountState.getLastCheckedAt(),
  });
}

/**
 * Map a reported window onto the durations `UsageWindow` models. `group` is an
 * open set, so anything unrecognized lands on "org" (the generic slot) rather
 * than being forced into a rolling window it may not be.
 */
function durationForWindow(window: UsageLimitWindow): "5h" | "7d" | "org" {
  const group = window.group?.trim().toLowerCase();
  if (group === "weekly") return "7d";
  if (group === "session") return "5h";
  return "org";
}

/** The most-preferred candidate (already priority-sorted ascending). */
function bestEffort(candidates: RotationCandidate[]): string | null {
  return candidates.length > 0 ? candidates[0].accountId : null;
}
