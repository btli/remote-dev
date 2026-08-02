/**
 * UsageLimitWindowRepository - Port for persisting the per-window `limits[]`
 * array the Claude usage endpoint reports for an ACCOUNT. [remote-dev-n4x4.2]
 *
 * `claude_usage_limit_state` carries the fixed 5h/7d rollup and stays the
 * authoritative account-level state (dashboard, `/api/claude/usage`,
 * `profile_limit_changed`). THIS port carries the variable-length detail the
 * rollup cannot represent — most importantly `weekly_scoped` windows, which are
 * scoped to a single model and can read 100%/critical while the account-level
 * status still says "allowed".
 *
 * The write path REPLACES an account's windows wholesale, so a window that
 * disappears upstream cannot linger as stale state.
 */

/**
 * One reported usage window, normalized.
 *
 * `kind`, `group` and `severity` are deliberately plain strings: the endpoint's
 * vocabularies are open sets, so an unrecognized value must round-trip rather
 * than be dropped or coerced.
 */
export interface UsageLimitWindow {
  /** Open set. Observed: "session" | "weekly_all" | "weekly_scoped". */
  kind: string;
  /** Open set. Observed: "session" | "weekly". Null when not reported. */
  group: string | null;
  /** Utilization 0-100. */
  percent: number;
  /** Open set. Observed: "normal" | "critical". Null when not reported. */
  severity: string | null;
  /** When this window resets, or null. */
  resetsAt: Date | null;
  /**
   * The scoped model's DISPLAY NAME (e.g. "Fable"), or null for an
   * account-level window. `scope.model.id` is null upstream, so the display
   * name is the only usable per-model identity.
   */
  scopeModel: string | null;
  /** The scoped surface, or null. */
  scopeSurface: string | null;
  /** Whether this window is the one actually binding right now. */
  isActive: boolean;
}

export interface UsageLimitWindowRepository {
  /**
   * Replace every stored window for `accountId` with `windows`.
   *
   * Atomic replace, not merge: rows absent from `windows` are deleted. An
   * empty array clears the account's windows. Returns false when the write was
   * skipped (e.g. the account has no owner row); best-effort, never throws for
   * a missing account.
   */
  replaceForAccount(
    accountId: string,
    windows: UsageLimitWindow[]
  ): Promise<boolean>;

  /** The stored windows for one account (empty when none recorded). */
  findByAccountId(accountId: string): Promise<UsageLimitWindow[]>;

  /**
   * Windows for many accounts, keyed by accountId. Accounts with no stored
   * windows are omitted from the map.
   */
  findManyByAccountIds(
    ids: string[]
  ): Promise<Map<string, UsageLimitWindow[]>>;
}
