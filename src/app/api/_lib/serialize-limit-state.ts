/**
 * Shared serialization for Claude usage-limit API responses. [remote-dev-wb0q]
 *
 * One small DRY helper so every route emits the same `limitState` JSON shape
 * (`LimitStateBlock` / `SerializedLimitState`). Wave D (UI / ProfileContext)
 * depends on this exact shape — keep it stable.
 *
 * A profile with no stored row serializes as an available/unknown default
 * (all numeric/timestamp fields null, status "unknown"). Timestamps are emitted
 * as epoch-ms numbers (matching the DB `timestampMs` columns) so the client can
 * compute reset countdowns without parsing.
 */

import type { LimitState } from "@/domain/value-objects/LimitState";
import type {
  ClaudeAccountKind,
  LimitStateBlock,
} from "@/types/claude-limits";
import type { AgentProvider } from "@/types/agent";
import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { inArray } from "drizzle-orm";

/**
 * Wire shape for limit-state API responses. Alias of the shared client type so
 * routes and UI cannot drift apart.
 */
export type SerializedLimitState = LimitStateBlock;

/**
 * Serialize a domain `LimitState` (or null) into the wire shape.
 *
 * `null` → available/unknown default. Otherwise the shared
 * {@link LimitState.toSnapshot} projection is mapped onto the wire shape, with
 * its Date timestamps converted to epoch-ms. The wire shape intentionally omits
 * the snapshot's `detectionSource` / `lastCheckedAt` (the client doesn't need
 * them); `limitStatus` follows the domain (limited → "limited"; not limited
 * with no source observed → "unknown"; else "available").
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

  const snap = state.toSnapshot();
  return {
    limitStatus: snap.limitStatus,
    window5hPct: snap.window5hPct,
    window7dPct: snap.window7dPct,
    resetAt5h: toEpochMs(snap.resetAt5h),
    resetAt7d: toEpochMs(snap.resetAt7d),
    effectiveResetAt: toEpochMs(snap.effectiveResetAt),
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
  /** The owning `claude_account.id`, or null when the profile has none. */
  accountId: string | null;
  accountKind: ClaudeAccountKind;
  emailAddress: string | null;
  organizationName: string | null;
}

/** The default when a profile has no `claude_account` row yet (Phase 2 fills it). */
const DEFAULT_ACCOUNT_INFO: ClaudeAccountInfo = {
  accountId: null,
  accountKind: "subscription",
  emailAddress: null,
  organizationName: null,
};

/**
 * Batch-load Claude-account info for many profiles, keyed by profileId, via the
 * retained `claude_account.profile_id` origin breadcrumb. Profiles without a
 * row are omitted (callers fall back to {@link DEFAULT_ACCOUNT_INFO}).
 *
 * [remote-dev-n4x4.6] `profile_id` is nullable + NON-unique now, so a profile
 * that somehow originated several accounts resolves to the first one. This is a
 * BACK-COMPAT shim for the profile-shaped `/api/profiles` payload — new surfaces
 * should read accounts directly via `claude-account-service`.
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
    if (!row.profileId || out.has(row.profileId)) continue;
    out.set(row.profileId, {
      accountId: row.id,
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
