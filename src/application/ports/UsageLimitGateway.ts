/**
 * UsageLimitGateway - Port for observing a Claude ACCOUNT's usage-limit state.
 *
 * A gateway knows how to detect whether an account is currently rate-limited,
 * and (when available) the reset times, window utilization, and the full set of
 * reported windows. Different gateways serve different account kinds and
 * detection strategies (reactive output parse, proactive endpoint poll); the
 * CompositeUsageLimitGateway dispatches to the first that `supports()` the
 * account's AccountKind.
 *
 * [remote-dev-n4x4.4] The port is ACCOUNT-keyed. It used to take a profileId,
 * a leftover from the pre-n4x4.6 layout where a Claude account was 1:1 with an
 * agent profile; the proactive poller now reads its credential from
 * `claude_account.oauth_token_encrypted`, so an account with no origin profile
 * is pollable and a profile is no longer an identity. `profileId` survives on
 * the target only as an optional breadcrumb for adapters that still want it.
 *
 * Pure interface — no implementation here.
 */

import type {
  ClaudeAccountKind,
  UsageDetectionSource,
} from "@/types/claude-limits";
import type { UsageLimitWindow } from "./UsageLimitWindowRepository";

/** The account a gateway is being asked to observe. */
export interface UsageLimitTarget {
  /** The `claude_account.id` to observe. The identity. */
  accountId: string;
  /** The owning user (ownership-scoped credential resolution). */
  userId: string;
  /**
   * The account's *origin* `agent_profile` id, when it has one. A legacy
   * breadcrumb only — never an identity, and null for standalone accounts.
   */
  profileId?: string | null;
}

/**
 * A single limit observation for an account, normalized across gateways.
 * Reset times / window percentages are null when the gateway could not
 * determine them (reset is always optional).
 */
export interface LimitDetectionResult {
  accountId: string;
  isLimited: boolean;
  resetAt5h: Date | null;
  resetAt7d: Date | null;
  window5hPct: number | null;
  window7dPct: number | null;
  source: UsageDetectionSource;
  /**
   * Every window the gateway observed, including per-model (`weekly_scoped`)
   * ones the 5h/7d rollup above cannot represent. Empty when the gateway has
   * no per-window detail. [remote-dev-n4x4.2]
   */
  windows: UsageLimitWindow[];
}

export interface UsageLimitGateway {
  /** Whether this gateway can observe accounts of the given kind. */
  supports(kind: ClaudeAccountKind): boolean;

  /**
   * Fetch the current limit observation for an account, or null when this
   * gateway cannot produce one (unsupported kind, disabled, or best-effort
   * failure). Implementations must be best-effort: never throw.
   */
  fetchLimitState(
    target: UsageLimitTarget
  ): Promise<LimitDetectionResult | null>;
}
