/**
 * relaunch-orchestration - Concrete wiring for `RelaunchOnLimitUseCase`.
 *
 * Wave B left the use-case un-wired in the DI container on purpose: its
 * Notification/SessionLauncher adapters touch `notification-service` and
 * `session-service`, and those modules transitively import the DI container
 * (`@/infrastructure/container`). Wiring the use-case from inside `container.ts`
 * would create an init-time import cycle (container → services → container).
 *
 * This module is the single integration seam instead. ONLY `@/server/terminal`
 * imports it. It is NOT imported by `container.ts` and NOT imported by
 * `session-service` — so no cycle forms at module init. The one edge that could
 * close a cycle (this module → `session-service` → … → `container`) is broken
 * by a LAZY `import()` of `session-service` inside the launcher adapter; the
 * static import graph here only reaches the container (for
 * `profileSelectionPolicy`), the preferences service, and the notification
 * service — none of which statically import this file.
 *
 *   terminal.ts ──> relaunch-orchestration ──> container (profileSelectionPolicy)
 *                                          ├─> preferences-service (mode)
 *                                          ├─> notification-service (notify)
 *                                          └─> (lazy) session-service (launch)
 */

import { profileSelectionPolicy } from "@/infrastructure/container";
import {
  RelaunchOnLimitUseCase,
  type RelaunchOnLimitInput,
  type RelaunchAction,
} from "@/application/use-cases/profile";
import type { AutoRelaunchModePort } from "@/application/ports/AutoRelaunchModePort";
import type { NotificationPort } from "@/application/ports/NotificationPort";
import type {
  SessionLauncherPort,
  LaunchReplacementInput,
  LaunchReplacementResult,
} from "@/application/ports/SessionLauncherPort";
import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";
import type { AgentProviderType } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("RelaunchOrchestration");

/**
 * Resolves the effective auto-relaunch mode from the inherited preference chain
 * (project override → global default → "notify"). `getResolvedPreferences`
 * already folds user settings + the project/group inheritance and surfaces a
 * non-null `claudeAutoRelaunchMode` (defaulting to "notify"), so a single read
 * is authoritative.
 */
const modePort: AutoRelaunchModePort = {
  async resolveMode(
    userId: string,
    projectId: string
  ): Promise<ClaudeAutoRelaunchMode> {
    const { getResolvedPreferences } = await import(
      "@/services/preferences-service"
    );
    const resolved = await getResolvedPreferences(userId, projectId);
    return resolved.claudeAutoRelaunchMode ?? "notify";
  },
};

/**
 * Surfaces usage-limit notifications via the in-app notification service.
 *
 * - With a `relaunch` CTA → `agent_waiting` (actionable + push-eligible). The
 *   `relaunch` payload rides in `meta.relaunch` so the client can offer a
 *   1-click "relaunch under <profile>" that POSTs to `/api/sessions`; a
 *   `deepLinkSessionId` + open-session CTA keep it tappable everywhere else.
 * - Without a `relaunch` CTA (all profiles limited) → informational `info`
 *   (passive), no relaunch affordance.
 *
 * Best-effort: never throws (the use-case treats notification as fire-and-forget).
 */
const notificationPort: NotificationPort = {
  async notifyLimit(notification): Promise<void> {
    try {
      const { createNotification } = await import(
        "@/services/notification-service"
      );
      const actionable = notification.relaunch != null;
      await createNotification({
        userId: notification.userId,
        sessionId: notification.sessionId,
        sessionName: notification.sessionName,
        type: actionable ? "agent_waiting" : "info",
        severity: actionable ? "actionable" : "passive",
        title: notification.title,
        body: notification.body,
        meta: {
          deepLinkSessionId: notification.sessionId,
          cta: { label: "Open session", action: "open_session" },
          // Carry the relaunch payload for the 1-click CTA. Typed loosely on
          // NotificationMeta (open record) so the client can read it without a
          // schema migration.
          ...(notification.relaunch
            ? { relaunch: notification.relaunch }
            : {}),
        },
      });
    } catch (error) {
      // Swallow — the use-case logs the higher-level outcome; a failed
      // notification must not break the limit-handling path.
      log.warn("notifyLimit failed (best-effort)", {
        userId: notification.userId,
        sessionId: notification.sessionId,
        error: String(error),
      });
    }
  },
};

/**
 * Launches a NEW parallel session under an available profile via the same
 * `session-service` create path `POST /api/sessions` uses. The originating
 * session is NEVER killed/stopped.
 *
 * `session-service` is imported LAZILY here to break the would-be cycle
 * (this module → session-service → … → container → this module): the static
 * graph of this file stops at the container, and session-service is only
 * pulled in at call time.
 *
 * The replacement is named "<origin> (rotated)" and given a unique `scopeKey`
 * so the create path's scope-key dedup cannot collapse it onto the originating
 * session.
 */
const sessionLauncher: SessionLauncherPort = {
  async launch(
    input: LaunchReplacementInput
  ): Promise<LaunchReplacementResult> {
    const SessionService = await import("@/services/session-service");

    // Derive a name from the originating session when we can read it; fall back
    // to a generic rotated name. Best-effort — naming is cosmetic.
    let originName = "Session";
    try {
      const { db } = await import("@/db");
      const { terminalSessions } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const origin = await db.query.terminalSessions.findFirst({
        where: eq(terminalSessions.id, input.originatingSessionId),
        columns: { name: true },
      });
      if (origin?.name) originName = origin.name;
    } catch {
      // ignore — use the fallback name
    }

    const session = await SessionService.createSession(input.userId, {
      name: `${originName} (rotated)`,
      projectId: input.projectId,
      terminalType: "agent",
      agentProvider: input.agentProvider as AgentProviderType,
      autoLaunchAgent: true,
      profileId: input.profileId,
      // Distinct, single-use scope key so dedup never folds this onto the
      // originating session (or a prior rotation). A fresh UUID guarantees no
      // collision with the limited session's scope.
      scopeKey: `relaunch:${input.originatingSessionId}:${crypto.randomUUID()}`,
    });

    return { sessionId: session.id };
  },
};

/**
 * The concrete `RelaunchOnLimitUseCase`, wired with the adapters above and the
 * container's shared `profileSelectionPolicy`. Imported by `terminal.ts`.
 */
export const relaunchOnLimitUseCase = new RelaunchOnLimitUseCase(
  modePort,
  profileSelectionPolicy,
  notificationPort,
  sessionLauncher
);

/**
 * Convenience wrapper for callers (terminal.ts) that want fire-and-forget
 * limit handling: runs the use-case and logs the outcome/any error, never
 * throwing into the caller's path.
 */
export async function handleSessionLimit(
  input: RelaunchOnLimitInput
): Promise<RelaunchAction | null> {
  try {
    const action = await relaunchOnLimitUseCase.execute(input);
    log.debug("Handled session limit", {
      sessionId: input.sessionId,
      action: action.kind,
    });
    return action;
  } catch (error) {
    log.error("Failed to handle session limit", {
      sessionId: input.sessionId,
      projectId: input.projectId,
      error: String(error),
    });
    return null;
  }
}
