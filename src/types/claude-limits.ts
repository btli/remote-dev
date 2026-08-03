/**
 * Types for Claude ACCOUNT usage-limit management (cswap-style).
 *
 * [remote-dev-n4x4.6] A Claude account is a first-class row, decoupled from
 * `agent_profile`: sessions share one Claude config dir and select their
 * account by having `CLAUDE_CODE_OAUTH_TOKEN` injected. These brands describe
 * the Claude-specific identity, usage-limit state, and rotation behavior. Used
 * as `.$type<X>()` schema brands and across the domain / application /
 * infrastructure layers.
 */

/**
 * Whether a Claude account authenticates via an OAuth subscription login or a
 * raw API key. Both kinds coexist side by side; window semantics differ
 * (subscription = rolling 5h/7d windows, api_key = rate/credits).
 */
export type ClaudeAccountKind = "subscription" | "api_key";

/**
 * Authoritative availability of a Claude account.
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

// ─────────────────────────────────────────────────────────────────────────────
// Client / wire shapes (Wave D)
//
// These mirror the JSON the REST routes emit (see
// `src/app/api/_lib/serialize-limit-state.ts`). Timestamps are epoch-ms numbers
// (null when unknown) so the client can compute reset countdowns without
// parsing. Kept here so ProfileContext + the Claude-limits components share one
// definition.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The serialized usage-limit block returned by `/api/profiles`,
 * `/api/claude-accounts/[accountId]/limit-state`, `/api/claude/usage`, and the
 * pool routes (also exported from `_lib/serialize-limit-state` as
 * `SerializedLimitState`). All timestamps are epoch-ms numbers; null means
 * "unknown".
 */
export interface LimitStateBlock {
  limitStatus: ClaudeLimitStatus;
  /** 0-100, or null if that window has not been observed. */
  window5hPct: number | null;
  window7dPct: number | null;
  /** Epoch-ms timestamps, or null if unknown. */
  resetAt5h: number | null;
  resetAt7d: number | null;
  /** min(resetAt5h, resetAt7d): soonest the account is available again. */
  effectiveResetAt: number | null;
}

/**
 * A Claude account as returned by `GET /api/claude-accounts` (and by
 * `claude-account-service` as `ClaudeAccountView`). Token-free by construction:
 * `hasToken` reports whether an encrypted session OAuth token is stored and
 * `usageCredential` reports whether a usage refresh credential is stored; no
 * token itself ever crosses the wire.
 */
export interface ClaudeAccountSummary {
  id: string;
  alias: string | null;
  accountKind: ClaudeAccountKind;
  emailAddress: string | null;
  organizationId: string | null;
  organizationName: string | null;
  rateLimitTier: string | null;
  /** Verbatim `authMethod` from `claude auth status --json` (open set). */
  authMethod: string | null;
  /** Whether the last identity probe reported `loggedIn: true`. */
  authHealthy: boolean;
  /** Epoch-ms of the last identity probe, or null. */
  lastVerifiedAt: number | null;
  hasToken: boolean;
  /** Whether an encrypted usage OAuth refresh credential is stored. */
  usageCredential: boolean;
  /** Legacy origin profile, when this account was migrated from one. */
  profileId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** An account in the `/api/claude/usage` dashboard payload. */
export interface ClaudeUsageAccount extends ClaudeAccountSummary {
  limitState: LimitStateBlock;
  /** Ids of the user's pools this account is a member of. */
  pools: string[];
}

/** A pool summary as returned by `GET /api/claude-pools`. */
export interface ClaudePoolSummary {
  id: string;
  name: string;
  memberCount: number;
}

/** A pool member resolved to an account label + serialized limit state. */
export interface ClaudePoolMember {
  accountId: string;
  /** Alias, else email, else null. */
  name: string | null;
  priority: number;
  limitState: LimitStateBlock;
}

/** A full pool with members (`GET /api/claude-pools/[poolId]`). */
export interface ClaudePoolDetail {
  id: string;
  name: string;
  members: ClaudePoolMember[];
}

/**
 * The `profile_limit_changed` WebSocket payload broadcast by the terminal
 * server when an ACCOUNT's limit state changes. Timestamps are ISO strings on
 * the wire (the broadcaster serializes Dates via `toISOString()`), distinct
 * from the epoch-ms numbers the REST routes emit. The event name is retained
 * for wire compatibility; the payload keys on `accountId` [remote-dev-n4x4.6].
 */
export interface ProfileLimitChangedEvent {
  accountId: string;
  limitStatus: ClaudeLimitStatus;
  resetAt5h: string | null;
  resetAt7d: string | null;
  window5hPct: number | null;
  window7dPct: number | null;
}
