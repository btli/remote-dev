/**
 * Pure formatting helpers for Claude usage-limit UI. [remote-dev-0yix]
 *
 * Shared by the Claude Accounts dashboard, the pool panel, and the wizard's
 * ProfileSelector badge so countdown / label rendering is consistent. No React,
 * no I/O — just (epoch-ms | null) → string. `now` is injectable for testing and
 * for the dashboard's live ticking.
 */

import type { LimitStateBlock } from "@/types/claude-limits";

/**
 * Format the milliseconds-until-reset as a compact countdown, e.g. "3h 12m",
 * "12m", "<1m". Returns null when the timestamp is null or already in the past
 * (the account is effectively available again).
 */
export function formatResetCountdown(
  resetAtMs: number | null,
  now: number = Date.now()
): string | null {
  if (resetAtMs === null || !Number.isFinite(resetAtMs)) return null;
  const deltaMs = resetAtMs - now;
  if (deltaMs <= 0) return null;

  // Sub-minute remainder reads as "<1m" rather than rounding up to a full
  // minute that hasn't elapsed.
  const totalMinutes = Math.floor(deltaMs / 60_000);
  if (totalMinutes < 1) return "<1m";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Short human label for a limit state's status, including a reset countdown
 * when limited and known (e.g. "Limited — resets in 3h 12m").
 */
export function formatLimitStatusLabel(
  state: LimitStateBlock | null,
  now: number = Date.now()
): string {
  if (!state || state.limitStatus === "unknown") return "Unknown";
  if (state.limitStatus === "available") return "Available";
  // limited
  const countdown = formatResetCountdown(state.effectiveResetAt, now);
  return countdown ? `Limited — resets in ${countdown}` : "Limited";
}

/** A terse "resets in Xh" variant for compact spots (e.g. the wizard badge). */
export function formatLimitedBadgeLabel(
  state: LimitStateBlock | null,
  now: number = Date.now()
): string {
  const countdown = formatResetCountdown(state?.effectiveResetAt ?? null, now);
  return countdown ? `Limited — resets in ${countdown}` : "Limited";
}

/** Format a 0-100 utilization percent, or "—" when unknown (null). */
export function formatPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}

/** Whether the limit state should render as "limited" right now. */
export function isLimitedNow(state: LimitStateBlock | null): boolean {
  return state?.limitStatus === "limited";
}
