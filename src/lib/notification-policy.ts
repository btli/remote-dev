/**
 * [y5ch.7] Pluggable notification policy hook.
 *
 * `applyNotificationPolicy` is the single "event JSON → channel-flag decision"
 * gate. It is PURE (no I/O, no DB) so it is fully unit-testable: it takes the
 * create-notification input, the user's resolved prefs, and a focus/now context,
 * and returns `{ store, push, reason? }`. The notification service consults it
 * before persisting + pushing.
 *
 * The gate computes a built-in default decision, then consults an OPTIONAL
 * user-supplied policy hook (`setNotificationPolicyHook`) that may PATCH that
 * decision — the cmux-style external policy step. This is the no-code-change
 * extension point: a deployment can force-suppress, force-push, or downgrade
 * channels for any event without editing the default policy. With no hook
 * registered (the default), behavior is byte-identical to the built-in policy.
 */
import type { CreateNotificationInput, NotificationSeverity } from "@/types/notification";
import { notificationSeverity } from "@/types/notification";
import { createLogger } from "@/lib/logger";

const log = createLogger("NotificationPolicy");

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

/**
 * [y5ch.7] Optional external policy step. Receives the notification event JSON,
 * the built-in default decision, and the resolved prefs, and returns a PATCH to
 * merge over the base decision (or `null`/`undefined` to leave it unchanged).
 *
 * Only the keys present in the returned partial override the base — e.g.
 * `{ push: false, reason: "external_suppress" }` flips push off while keeping
 * the base `store`. Returning `{ store: false, push: false }` is the "stop"
 * verb. The hook MUST stay pure + synchronous (no I/O, no `await`) to match the
 * gate; throwing is tolerated (the base decision is used) but discouraged.
 */
export type NotificationPolicyHook = (
  event: CreateNotificationInput,
  baseDecision: Readonly<NotificationDecision>,
  prefs: ResolvedNotificationPrefs,
) => Partial<NotificationDecision> | null | undefined;

/**
 * Module-level slot for the single registered policy hook. `null` (the default)
 * means "no external step" — the gate returns the built-in decision verbatim.
 */
let policyHook: NotificationPolicyHook | null = null;

/**
 * [y5ch.7] Register (or clear, with `null`) the external notification policy
 * hook — the no-code-change anti-spam / routing lever. At most one hook is
 * active; calling this again replaces the previous one.
 *
 * Example:
 * ```ts
 * setNotificationPolicyHook((event, base) =>
 *   event.type === "agent_exited" ? { push: false, reason: "muted_exits" } : null,
 * );
 * ```
 */
export function setNotificationPolicyHook(hook: NotificationPolicyHook | null): void {
  policyHook = hook;
}

/** [y5ch.7] The currently registered policy hook, or `null` if none. */
export function getNotificationPolicyHook(): NotificationPolicyHook | null {
  return policyHook;
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
 * The built-in default policy (no external hook applied):
 *   - per-session mute ⇒ neither store nor push.
 *   - always store in-app (the panel is the durable record) unless session-muted.
 *   - push only when: not focused (y5ch.4) AND type not opted out AND
 *     severity ≥ minPushSeverity AND not in quiet hours.
 *   - errors always push (override quiet hours) but still respect session mute,
 *     focus, per-type opt-out, and the min-severity floor.
 */
function computeBaseDecision(
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

/**
 * The single "event JSON → channel-flag decision" gate. Computes the built-in
 * default decision, then — if an external policy hook is registered
 * ([y5ch.7], `setNotificationPolicyHook`) — consults it for a patch and merges
 * the result over the base.
 *
 * The hook is the no-code-change extension point. It is applied DEFENSIVELY: a
 * hook that throws is caught and logged, and the unmodified base decision is
 * returned — a broken hook must never suppress or break notifications. With no
 * hook registered (the default), the returned decision is byte-identical to the
 * built-in policy.
 */
export function applyNotificationPolicy(
  input: CreateNotificationInput,
  prefs: ResolvedNotificationPrefs,
  ctx: { now: Date; focused: boolean },
): NotificationDecision {
  const base = computeBaseDecision(input, prefs, ctx);

  const hook = policyHook;
  if (!hook) return base;

  try {
    // Pass a frozen copy so the hook can't mutate the base in place; it must
    // return a patch instead.
    const patch = hook(input, Object.freeze({ ...base }), prefs);
    if (!patch) return base;
    return { ...base, ...patch };
  } catch (err) {
    // A throwing hook falls back to the built-in decision — never break the
    // notification pipeline on a bad external policy.
    log.warn("Notification policy hook threw; using base decision", {
      error: String(err),
      type: input.type,
    });
    return base;
  }
}
