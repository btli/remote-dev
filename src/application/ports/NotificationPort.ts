/**
 * NotificationPort - Thin port for surfacing usage-limit notifications.
 *
 * Keeps `RelaunchOnLimitUseCase` unit-testable: the use-case depends on this
 * abstraction, not the concrete notification-service. The Wave C adapter maps
 * `notifyLimit` onto `createNotification` (type `agent_waiting` for the
 * relaunchable case so it is actionable + push-eligible; `info`/`agent_error`
 * for the all-limited case), packing `relaunch` into the notification `meta`
 * so the client can offer a 1-click "relaunch under <profile>" CTA that POSTs
 * to `/api/sessions`.
 */

/**
 * Payload for a "your account is limited" notification with an optional
 * 1-click relaunch CTA. When `relaunch` is present the client can spawn a new
 * session under `relaunch.profileId`; when it is absent (e.g. all profiles
 * limited) the notification is informational only.
 */
export interface UsageLimitNotification {
  userId: string;
  /** The session that hit the limit (for deep-linking / coalescing). */
  sessionId: string;
  /** Human-readable session name, when known. */
  sessionName?: string;
  title: string;
  body?: string;
  /**
   * Relaunch call-to-action. Present when an alternate profile is available;
   * carries everything `POST /api/sessions` needs to spawn the replacement.
   * Absent when there is nothing to relaunch to (all limited).
   */
  relaunch?: {
    projectId: string;
    profileId: string;
    agentProvider: string;
  };
}

export interface NotificationPort {
  /** Surface a usage-limit notification (best-effort; should not throw). */
  notifyLimit(notification: UsageLimitNotification): Promise<void>;
}
