/**
 * UsageLimitStateRepository - Port for persisting Claude usage-limit state.
 *
 * Stores one authoritative LimitState per profile. The write path carries a
 * staleness guard (`onlyIfNewer`) so a slower/older detection source cannot
 * clobber a strictly-newer observation.
 *
 * Repository methods speak the domain LimitState value object, not DB rows.
 */

import type { LimitState } from "@/domain/value-objects/LimitState";

export interface UsageLimitStateRepository {
  /** The stored state for a profile, or null if none recorded yet. */
  findByProfileId(profileId: string): Promise<LimitState | null>;

  /** States for many profiles, keyed by profileId (missing ids omitted). */
  findManyByProfileIds(ids: string[]): Promise<Map<string, LimitState>>;

  /**
   * Upsert the state for `state.getProfileId()`.
   *
   * When `opts.onlyIfNewer` is provided, the write is skipped if the stored
   * row's `lastCheckedAt` is strictly newer than `onlyIfNewer` — i.e. a
   * fresher observation already won. A row with no `lastCheckedAt`, or no row
   * at all, is always overwritten.
   */
  upsert(state: LimitState, opts?: { onlyIfNewer?: Date }): Promise<void>;

  /** All stored states for a user's profiles. */
  listForUser(userId: string): Promise<LimitState[]>;
}
