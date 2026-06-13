/**
 * ProfileSelectionPolicy - Port for resolving which Claude profile to use.
 *
 * Encapsulates the primary→pool fallback + rotation logic for a project:
 *   - `selectForProject` picks the profile to launch for a project now.
 *   - `selectNextAvailable` picks an alternate when the current profile taps
 *     out (used by auto-relaunch).
 *
 * Semantics are deliberately non-throwing for the "launch now" path: a missing
 * configuration returns null (caller proceeds with no profile = legacy
 * behavior); an all-limited pool returns a best-effort profile rather than
 * blocking a launch. `ProfileAllLimitedError` is provided for callers that
 * DO want to treat "everything is limited" as exceptional.
 */

export interface ProfileSelectionPolicy {
  /**
   * The profile to use for a project right now: the configured primary if
   * available, else the best available pool member by rotation priority. If a
   * pool is configured but every candidate is limited, returns a best-effort
   * candidate (primary, else lowest-priority member) instead of blocking the
   * launch. Returns null only when nothing is configured (no primary, no pool).
   */
  selectForProject(
    projectId: string,
    userId: string,
    now: Date
  ): Promise<string | null>;

  /**
   * The next available profile for a project, EXCLUDING `currentProfileId`.
   * Returns the first available candidate by ascending priority, or null when
   * no other candidate is available (caller treats null as "all limited").
   */
  selectNextAvailable(
    currentProfileId: string,
    projectId: string,
    userId: string,
    now: Date
  ): Promise<string | null>;
}

/**
 * Raised when every candidate profile for a project is currently limited.
 * The "launch now" path does NOT throw this (it returns best-effort); it is
 * available for callers that want to surface an all-limited condition.
 */
export class ProfileAllLimitedError extends Error {
  constructor(
    readonly projectId: string,
    readonly earliestResetAt: Date | null
  ) {
    super("All pool profiles limited");
    this.name = "ProfileAllLimitedError";
  }
}
