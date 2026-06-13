/**
 * Types for Claude profile usage-limit management (cswap-style).
 *
 * Each remote-dev profile maps ~1:1 onto a Claude account (it sets its own
 * `CLAUDE_CONFIG_DIR`). These brands describe the Claude-specific identity,
 * usage-limit state, and rotation behavior layered on top of the
 * provider-agnostic `agent_profile`. Used as `.$type<X>()` schema brands and
 * across the domain / application / infrastructure layers.
 */

/**
 * Whether a Claude profile authenticates via an OAuth subscription login or a
 * raw API key. Both kinds coexist side by side; window semantics differ
 * (subscription = rolling 5h/7d windows, api_key = rate/credits).
 */
export type ClaudeAccountKind = "subscription" | "api_key";

/**
 * Authoritative availability of a profile's Claude account.
 * - available: not currently rate-limited (or never observed limited).
 * - limited: a usage limit was hit; becomes available again at the reset time.
 * - unknown: never observed (no detection has run yet).
 */
export type ClaudeLimitStatus = "available" | "limited" | "unknown";

/**
 * How a limit-state observation was produced.
 * - reactive: parsed from agent output / a hook (scrollback "usage limit reached").
 * - poller: fetched from the (flagged, unofficial) Anthropic usage endpoint.
 * - manual: a user override (e.g. "mark available").
 */
export type UsageDetectionSource = "reactive" | "poller" | "manual";

/**
 * What to do when a running session's Claude account taps out.
 * - notify: surface a notification with a 1-click relaunch CTA (default).
 * - auto: spawn a parallel session under an available profile (never force-kill).
 * - disabled: do nothing.
 */
export type ClaudeAutoRelaunchMode = "notify" | "auto" | "disabled";
