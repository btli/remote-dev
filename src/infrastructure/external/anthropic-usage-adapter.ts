/**
 * anthropic-usage-adapter - The ONE volatile seam for proactive usage polling.
 *
 * cswap reads an unofficial Anthropic usage endpoint to learn a subscription
 * account's 5h/7d utilization + reset times without waiting to hit a limit.
 * That endpoint is undocumented and may change, so ALL knowledge of it lives
 * here behind a single function. Everything upstream (the poller, the gateway,
 * the use-cases) depends only on the normalized `ClaudeUsageSnapshot`.
 *
 * Stub-safe: this returns `null` for now. The real HTTP call is implemented in
 * Phase 2 (bd remote-dev-6bos). Returning null makes the poller a safe no-op
 * even when its feature flag is on.
 *
 * Intended request shape (Phase 2):
 *   GET https://api.anthropic.com/api/usage   (exact path TBD)
 *   Authorization: Bearer <oauth access token from the profile's
 *                  .claude/.credentials.json>
 *   anthropic-version: 2023-06-01
 * Intended response headers carry the unified rate-limit window state:
 *   anthropic-ratelimit-unified-5h-remaining / -limit / -reset (unix epoch)
 *   anthropic-ratelimit-unified-7d-remaining / -limit / -reset (unix epoch)
 * from which we derive utilization pct = (limit - remaining) / limit * 100 and
 * the reset Date = new Date(reset * 1000).
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("AnthropicUsageAdapter");

/** Normalized usage reading for one Claude account. */
export interface ClaudeUsageSnapshot {
  /** 5h rolling window utilization, 0-100, or null if not reported. */
  window5hPct: number | null;
  /** 7d rolling window utilization, 0-100, or null if not reported. */
  window7dPct: number | null;
  /** When the 5h window resets, or null. */
  resetAt5h: Date | null;
  /** When the 7d window resets, or null. */
  resetAt7d: Date | null;
}

/**
 * Fetch a usage snapshot for the account behind `token`.
 *
 * @param token OAuth access token (subscription) for the profile's account.
 * @returns A normalized snapshot, or null when usage cannot be determined
 *   (always null until Phase 2 implements the real endpoint).
 */
export async function fetchClaudeUsage(
  token: string
): Promise<ClaudeUsageSnapshot | null> {
  // Phase 2 (remote-dev-6bos) will perform the real request here. Until then,
  // we deliberately do nothing so the proactive poller is a safe no-op.
  void token;
  log.trace("fetchClaudeUsage stub invoked (Phase 2 not yet implemented)");
  return null;
}
