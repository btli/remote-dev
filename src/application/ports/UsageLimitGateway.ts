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
 * [remote-dev-u7df] `fetchLimitState` can also yield a typed
 * {@link UsageLimitRateLimited} signal: the upstream read was refused (HTTP
 * 429 + retry-after), so no observation exists, but the refusal names the
 * earliest useful retry time. Distinct from a plain null failure so the sweep
 * can align its next attempt to the reset instead of blind backoff.
 *
 * Pure types — no implementation here beyond the trivial narrowing guard.
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

/**
 * The upstream refused the read with a rate limit (HTTP 429 + retry-after).
 * Carries no usage data — it is NOT an observation — but names the earliest
 * time a retry can be expected to succeed. [remote-dev-u7df]
 */
export interface UsageLimitRateLimited {
  rateLimited: true;
  accountId: string;
  /** Earliest time the upstream is expected to serve the read again. */
  retryAt: Date;
}

/** Narrow a non-null fetch result to the rate-limited signal. */
export function isUsageLimitRateLimited(
  result: LimitDetectionResult | UsageLimitRateLimited
): result is UsageLimitRateLimited {
  return "rateLimited" in result && result.rateLimited === true;
}

export interface UsageLimitGateway {
  /** Whether this gateway can observe accounts of the given kind. */
  supports(kind: ClaudeAccountKind): boolean;

  /**
   * Fetch the current limit observation for an account; a typed
   * {@link UsageLimitRateLimited} signal when the upstream refused the read
   * with a retry-after; or null when this gateway cannot produce either
   * (unsupported kind, disabled, or best-effort failure). Implementations
   * must be best-effort: never throw.
   */
  fetchLimitState(
    target: UsageLimitTarget
  ): Promise<LimitDetectionResult | UsageLimitRateLimited | null>;
}
