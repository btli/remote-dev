/**
 * UsageLimitStateRepository - Port for persisting Claude usage-limit state.
 *
 * Stores one authoritative LimitState per ACCOUNT (`claude_account.id`). Limits
 * belong to the Claude subscription, not to the agent profile / config dir the
 * session happens to run under. [remote-dev-n4x4.6]
 *
 * The write path carries a staleness guard (`onlyIfNewer`) so a slower/older
 * detection source cannot clobber a strictly-newer observation.
 *
 * Repository methods speak the domain LimitState value object, not DB rows.
 */

import type { LimitState } from "@/domain/value-objects/LimitState";

export interface UsageLimitStateRepository {
  /** The stored state for an account, or null if none recorded yet. */
  findByAccountId(accountId: string): Promise<LimitState | null>;

  /** States for many accounts, keyed by accountId (missing ids omitted). */
  findManyByAccountIds(ids: string[]): Promise<Map<string, LimitState>>;

  /**
   * Upsert the state for `state.getAccountId()`.
   *
   * When `opts.onlyIfNewer` is provided, the write is skipped if the stored
   * row's `lastCheckedAt` is strictly newer than `onlyIfNewer` — i.e. a
   * fresher observation already won. A row with no `lastCheckedAt`, or no row
   * at all, is always overwritten.
   *
   * Returns `true` when the write was persisted, `false` when the staleness
   * guard skipped it. Callers use this to avoid acting on (broadcasting /
   * relaunching) a state the DB did not actually accept.
   */
  upsert(state: LimitState, opts?: { onlyIfNewer?: Date }): Promise<boolean>;

  /** All stored states for a user's accounts. */
  listForUser(userId: string): Promise<LimitState[]>;
}
