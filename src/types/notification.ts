/**
 * Notification types for in-app notification panel.
 *
 * [y5ch] Notifications carry a `severity` class derived from their `type`.
 * Severity drives push-gating (y5ch.10), the client halo/dot (y5ch.8), and
 * coalescing grouping (y5ch.5). The classifier `notificationSeverity()` is the
 * single source of truth (type → severity), consumed by the terminal server,
 * the policy hook, and the FCM gate.
 */

export type NotificationType =
  | "agent_waiting"
  | "agent_error"
  | "agent_complete"
  | "agent_exited"
  | "build_fail"
  | "session_closed"
  | "update_pending"
  | "update_applied"
  | "agent_stuck" // [y5ch] emitted by the liveness sweep (y5ch.9)
  | "info";

/** [y5ch] Signal class. Drives push-gating, client halo, coalescing. */
export type NotificationSeverity = "actionable" | "passive" | "error";

/**
 * [y5ch] Single source of truth: type → severity.
 *
 *   - actionable: the agent needs the human (waiting, build failed, update ready).
 *   - error:      something broke or the agent is stuck/crashed.
 *   - passive:    informational lifecycle pings (clean stop/complete/closed/info).
 */
export function notificationSeverity(type: NotificationType): NotificationSeverity {
  switch (type) {
    case "agent_waiting": // agent needs the human → actionable
    case "build_fail":
    case "update_pending":
      return "actionable";
    case "agent_error":
    case "agent_stuck":
      return "error";
    case "agent_complete":
    case "agent_exited":
    case "session_closed":
    case "update_applied":
    case "info":
      return "passive";
    default:
      return "passive";
  }
}

/**
 * [y5ch] Coalescing group key (y5ch.5). Notifications sharing
 * `(userId, sessionId, group)` collapse into ONE open row rather than stacking.
 * Lifecycle pings per session collapse together; failures collapse together;
 * everything else coalesces only with the same type.
 */
export function notificationGroup(type: NotificationType): string {
  switch (type) {
    case "agent_waiting":
    case "agent_complete":
    case "agent_exited":
    case "agent_stuck":
      return "agent_lifecycle"; // collapse repeated lifecycle pings per session
    case "agent_error":
    case "build_fail":
      return "agent_failure";
    default:
      return type; // update_pending/applied/session_closed/info coalesce only with same type
  }
}

/** [y5ch] Richer payload for client routing/CTA (y5ch.8). */
export interface NotificationMeta {
  /** Session to deep-link into when tapped. */
  deepLinkSessionId?: string;
  /** Optional CTA label + action verb the client maps to a handler. */
  cta?: { label: string; action: "open_session" | "view_diff" | "rerun" | "dismiss" };
  /** Agent run duration in ms (clean-complete summaries). */
  durationMs?: number;
  /** Terminal result, e.g. "success" | "failed" | exit code as string. */
  result?: string;
}

export interface NotificationEvent {
  id: string;
  userId: string;
  sessionId: string | null;
  sessionName: string | null;
  type: NotificationType;
  /** [y5ch] Signal class derived from `type` (or explicitly overridden). */
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** [y5ch] Coalescing count: 1 normally, >1 when collapsed. */
  count: number;
  /** [y5ch] Structured client-routing payload (deep-link, duration, result). */
  meta: NotificationMeta | null;
  readAt: Date | null;
  createdAt: Date;
  /** [y5ch] Last time the (possibly coalesced) row was touched. */
  updatedAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  sessionId?: string;
  sessionName?: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** [y5ch] Override; defaults to notificationSeverity(type). */
  severity?: NotificationSeverity;
  /** [y5ch] Structured client-routing payload (y5ch.8). */
  meta?: NotificationMeta;
  /** [y5ch] true when the target session is currently focused by the user (y5ch.4). */
  focused?: boolean;
}
