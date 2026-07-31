/**
 * ProfileSelectionPolicy - Port for resolving which Claude ACCOUNT to use.
 *
 * Encapsulates the primary→pool fallback + rotation logic for a project:
 *   - `selectForProject` picks the account to launch for a project now.
 *   - `selectNextAvailable` picks an alternate when the current account taps
 *     out (used by auto-relaunch).
 *
 * As of [remote-dev-n4x4.6] the unit of rotation is a Claude account, not an
 * agent profile: sessions share one Claude config dir and get their identity
 * from an injected `CLAUDE_CODE_OAUTH_TOKEN`. The selection still reports the
 * account's *origin* profile (`profileId`, nullable) so the caller can keep
 * applying that profile's env overlay when one exists.
 *
 * Semantics are deliberately non-throwing for the "launch now" path: a missing
 * configuration returns null (caller proceeds with no account = legacy
 * behavior); an all-limited pool returns a best-effort account rather than
 * blocking a launch.
 */

/** The account chosen by the policy, plus its origin profile when known. */
export interface SelectedAccount {
  accountId: string;
  /**
   * The account's origin `agent_profile` id, or null when the account is not
   * tied to one (the normal case for accounts added via "Add account").
   */
  profileId: string | null;
}

export interface ProfileSelectionPolicy {
  /**
   * The account to use for a project right now: the configured primary if
   * available, else the best available pool member by rotation priority. If a
   * pool is configured but every candidate is limited, returns a best-effort
   * candidate (primary, else lowest-priority member) instead of blocking the
   * launch. Returns null only when nothing is configured (no primary, no pool).
   */
  selectForProject(
    projectId: string,
    userId: string,
    now: Date
  ): Promise<SelectedAccount | null>;

  /**
   * The next available account for a project, EXCLUDING `currentAccountId`.
   * Returns the first available candidate by ascending priority, or null when
   * no other candidate is available (caller treats null as "all limited").
   */
  selectNextAvailable(
    currentAccountId: string,
    projectId: string,
    userId: string,
    now: Date
  ): Promise<SelectedAccount | null>;
}
