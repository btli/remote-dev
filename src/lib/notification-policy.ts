/**
 * [y5ch.7] Pluggable notification policy hook.
 *
 * `applyNotificationPolicy` is the single "event JSON → channel-flag decision"
 * gate. It is PURE (no I/O, no DB) so it is fully unit-testable: it takes the
 * create-notification input, the user's resolved prefs, and a focus/now context,
 * and returns `{ store, push, reason? }`. The notification service consults it
 * before persisting + pushing.
 */
import type { CreateNotificationInput, NotificationSeverity } from "@/types/notification";
import { notificationSeverity } from "@/types/notification";

/** Resolved, already-merged prefs for one user (output of the prefs service). */
export interface ResolvedNotificationPrefs {
  /** Per-type push opt-out: `type → false` means "never push this type". */
  pushByType: Partial<Record<string, boolean>>;
  /** Per-session mute: sessionId present ⇒ suppress entirely (store + push). */
  mutedSessionIds: ReadonlySet<string>;
  /** Quiet hours in the user's local tz; null = disabled. */
  quietHours: { startHour: number; endHour: number } | null;
  /** Minimum severity that may push at all. */
  minPushSeverity: NotificationSeverity;
}

export interface NotificationDecision {
  /** Persist + broadcast an in-app notification row. */
  store: boolean;
  /** Dispatch an FCM push. */
  push: boolean;
  /** Human-readable reason when a channel is off (for logging only). */
  reason?: string;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  passive: 0,
  actionable: 1,
  error: 2,
};

/** True when `now` falls inside the quiet-hours window (wraps midnight). */
export function inQuietHours(
  now: Date,
  qh: { startHour: number; endHour: number } | null,
): boolean {
  if (!qh) return false;
  const h = now.getHours();
  return qh.startHour <= qh.endHour
    ? h >= qh.startHour && h < qh.endHour
    : h >= qh.startHour || h < qh.endHour; // wraps midnight (e.g. 22→7)
}

/**
 * The policy hook. Default policy:
 *   - per-session mute ⇒ neither store nor push.
 *   - always store in-app (the panel is the durable record) unless session-muted.
 *   - push only when: not focused (y5ch.4) AND type not opted out AND
 *     severity ≥ minPushSeverity AND not in quiet hours.
 *   - errors always push (override quiet hours) but still respect session mute,
 *     focus, per-type opt-out, and the min-severity floor.
 */
export function applyNotificationPolicy(
  input: CreateNotificationInput,
  prefs: ResolvedNotificationPrefs,
  ctx: { now: Date; focused: boolean },
): NotificationDecision {
  const severity = input.severity ?? notificationSeverity(input.type);

  if (input.sessionId && prefs.mutedSessionIds.has(input.sessionId)) {
    return { store: false, push: false, reason: "session_muted" };
  }
  if (ctx.focused) {
    return { store: true, push: false, reason: "session_focused" };
  }
  if (prefs.pushByType[input.type] === false) {
    return { store: true, push: false, reason: "type_opt_out" };
  }
  if (SEVERITY_RANK[severity] < SEVERITY_RANK[prefs.minPushSeverity]) {
    return { store: true, push: false, reason: "below_min_severity" };
  }
  if (severity !== "error" && inQuietHours(ctx.now, prefs.quietHours)) {
    return { store: true, push: false, reason: "quiet_hours" };
  }
  return { store: true, push: true };
}
