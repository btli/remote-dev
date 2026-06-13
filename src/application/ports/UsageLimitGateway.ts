/**
 * UsageLimitGateway - Port for observing a Claude profile's usage-limit state.
 *
 * A gateway knows how to detect whether a given profile's Claude account is
 * currently rate-limited, and (when available) the reset times + window
 * utilization. Different gateways serve different account kinds and detection
 * strategies (reactive output parse, proactive endpoint poll); the
 * CompositeUsageLimitGateway dispatches to the first that `supports()` the
 * profile's AccountKind.
 *
 * Pure interface — no implementation here.
 */

import type {
  ClaudeAccountKind,
  UsageDetectionSource,
} from "@/types/claude-limits";

/**
 * A single limit observation for a profile, normalized across gateways.
 * Reset times / window percentages are null when the gateway could not
 * determine them (reset is always optional).
 */
export interface LimitDetectionResult {
  profileId: string;
  isLimited: boolean;
  resetAt5h: Date | null;
  resetAt7d: Date | null;
  window5hPct: number | null;
  window7dPct: number | null;
  source: UsageDetectionSource;
}

export interface UsageLimitGateway {
  /** Whether this gateway can observe accounts of the given kind. */
  supports(kind: ClaudeAccountKind): boolean;

  /**
   * Fetch the current limit observation for a profile, or null when this
   * gateway cannot produce one (unsupported kind, disabled, or best-effort
   * failure). Implementations must be best-effort: never throw.
   */
  fetchLimitState(
    profileId: string,
    userId: string
  ): Promise<LimitDetectionResult | null>;
}
