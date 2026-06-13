/**
 * Shared serialization for Claude usage-limit API responses. [remote-dev-wb0q]
 *
 * One small DRY helper so every route emits the same `limitState` JSON shape.
 * Wave D (UI / ProfileContext) depends on this exact shape — keep it stable.
 *
 * A profile with no stored row serializes as an available/unknown default
 * (all numeric/timestamp fields null, status "unknown"). Timestamps are emitted
 * as epoch-ms numbers (matching the DB `timestampMs` columns) so the client can
 * compute reset countdowns without parsing.
 */

import type { LimitState } from "@/domain/value-objects/LimitState";
import type { ClaudeAccountKind, ClaudeLimitStatus } from "@/types/claude-limits";
import type { AgentProvider } from "@/types/agent";
import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

/** The serialized limit-state block shared across all profile/pool routes. */
export interface SerializedLimitState {
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
 * Serialize a domain `LimitState` (or null) into the wire shape.
 *
 * `null` → available/unknown default. Otherwise the windows are projected back
 * onto the 5h/7d dimensions, and `limitStatus` follows the domain:
 * limited → "limited"; not limited with no source observed → "unknown"; else
 * "available".
 */
export function serializeLimitState(
  state: LimitState | null
): SerializedLimitState {
  if (!state) {
    return {
      limitStatus: "unknown",
      window5hPct: null,
      window7dPct: null,
      resetAt5h: null,
      resetAt7d: null,
      effectiveResetAt: null,
    };
  }

  const windows = state.getWindows();
  const w5h = windows.find((w) => w.getDuration() === "5h");
  const w7d = windows.find((w) => w.getDuration() === "7d");

  const limitStatus: ClaudeLimitStatus = state.isLimited()
    ? "limited"
    : state.getSource() === null
      ? "unknown"
      : "available";

  return {
    limitStatus,
    window5hPct: w5h?.getUtilizationPct() ?? null,
    window7dPct: w7d?.getUtilizationPct() ?? null,
    resetAt5h: toEpochMs(w5h?.getResetAt() ?? null),
    resetAt7d: toEpochMs(w7d?.getResetAt() ?? null),
    effectiveResetAt: toEpochMs(state.earliestResetAt()),
  };
}

function toEpochMs(date: Date | null): number | null {
  return date ? date.getTime() : null;
}

/**
 * Whether a profile's provider can run Claude Code (and therefore carries a
 * Claude account / usage limits). Profiles created with provider "all" install
 * the Claude config dir too, so they are claude-capable.
 */
export function isClaudeCapable(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "all";
}

/** Claude-account display fields layered on top of agent_profile. */
export interface ClaudeAccountInfo {
  accountKind: ClaudeAccountKind;
  emailAddress: string | null;
  organizationName: string | null;
}

/** The default when a profile has no `claude_account` row yet (Phase 2 fills it). */
const DEFAULT_ACCOUNT_INFO: ClaudeAccountInfo = {
  accountKind: "subscription",
  emailAddress: null,
  organizationName: null,
};

/**
 * Load Claude-account info for one profile, defaulting to a subscription
 * account with null display fields when no row exists.
 */
export async function getClaudeAccountInfo(
  profileId: string
): Promise<ClaudeAccountInfo> {
  const row = await db.query.claudeAccounts.findFirst({
    where: eq(claudeAccounts.profileId, profileId),
  });
  if (!row) return { ...DEFAULT_ACCOUNT_INFO };
  return {
    accountKind: row.accountKind as ClaudeAccountKind,
    emailAddress: row.emailAddress ?? null,
    organizationName: row.organizationName ?? null,
  };
}

/**
 * Batch-load Claude-account info for many profiles, keyed by profileId.
 * Profiles without a row are omitted from the map (callers fall back to
 * {@link DEFAULT_ACCOUNT_INFO}).
 */
export async function getClaudeAccountInfoMany(
  profileIds: string[]
): Promise<Map<string, ClaudeAccountInfo>> {
  const out = new Map<string, ClaudeAccountInfo>();
  if (profileIds.length === 0) return out;
  const rows = await db.query.claudeAccounts.findMany({
    where: inArray(claudeAccounts.profileId, profileIds),
  });
  for (const row of rows) {
    out.set(row.profileId, {
      accountKind: row.accountKind as ClaudeAccountKind,
      emailAddress: row.emailAddress ?? null,
      organizationName: row.organizationName ?? null,
    });
  }
  return out;
}

/** The default account info (subscription, no display fields). */
export function defaultClaudeAccountInfo(): ClaudeAccountInfo {
  return { ...DEFAULT_ACCOUNT_INFO };
}
