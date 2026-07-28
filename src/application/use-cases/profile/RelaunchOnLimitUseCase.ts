/**
 * RelaunchOnLimitUseCase - React to a running session hitting a Claude limit.
 *
 * Resolves the effective auto-relaunch mode (project override → global default)
 * then acts:
 *   - `disabled` → log + noop.
 *   - `notify`   → surface a notification with a 1-click relaunch CTA (when an
 *                  alternate profile is available; otherwise an "all limited"
 *                  notification).
 *   - `auto`     → select the next available profile and launch a NEW parallel
 *                  session under it (NEVER force-kill the limited session). If
 *                  no alternate is available, fall back to an "all limited"
 *                  notification.
 *
 * Depends only on ports — unit-tested with in-memory fakes. NOT wired into the
 * container in this wave; the concrete Notification/SessionLauncher adapters
 * (which touch notification-service / session-service) are built in Wave C to
 * avoid an infra↔services import cycle.
 */

import type { AutoRelaunchModePort } from "@/application/ports/AutoRelaunchModePort";
import type { NotificationPort } from "@/application/ports/NotificationPort";
import type {
  ProfileSelectionPolicy,
  SelectedAccount,
} from "@/application/ports/ProfileSelectionPolicy";
import type { SessionLauncherPort } from "@/application/ports/SessionLauncherPort";
import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";
import { createLogger } from "@/lib/logger";

const log = createLogger("RelaunchOnLimit");

export interface RelaunchOnLimitInput {
  sessionId: string;
  userId: string;
  projectId: string;
  /** The Claude account that just hit its limit. */
  currentAccountId: string;
  /** Agent provider of the limited session (passed to launch / CTA). */
  agentProvider: string;
  /** Human-readable session name, when known (for the notification). */
  sessionName?: string;
  /** Decision time; defaults to now. */
  now?: Date;
}

/** What the use-case ended up doing — handy for tests + callers/logging. */
export type RelaunchAction =
  | { kind: "noop"; mode: ClaudeAutoRelaunchMode }
  | { kind: "notified"; relaunchAccountId: string }
  | { kind: "notified_all_limited" }
  | { kind: "relaunched"; newSessionId: string; accountId: string };

export class RelaunchOnLimitUseCase {
  constructor(
    private readonly modePort: AutoRelaunchModePort,
    private readonly selectionPolicy: ProfileSelectionPolicy,
    private readonly notificationPort: NotificationPort,
    private readonly sessionLauncher: SessionLauncherPort
  ) {}

  async execute(input: RelaunchOnLimitInput): Promise<RelaunchAction> {
    const now = input.now ?? new Date();
    const mode = await this.modePort.resolveMode(input.userId, input.projectId);

    if (mode === "disabled") {
      log.debug("Auto-relaunch disabled; ignoring limit", {
        sessionId: input.sessionId,
        projectId: input.projectId,
      });
      return { kind: "noop", mode };
    }

    // Both notify + auto need to know whether an alternate account exists.
    const next: SelectedAccount | null =
      await this.selectionPolicy.selectNextAvailable(
        input.currentAccountId,
        input.projectId,
        input.userId,
        now
      );

    if (mode === "notify") {
      if (next) {
        await this.notificationPort.notifyLimit({
          userId: input.userId,
          sessionId: input.sessionId,
          sessionName: input.sessionName,
          title: "Claude usage limit reached",
          body: "Tap to relaunch under an available account.",
          relaunch: {
            projectId: input.projectId,
            accountId: next.accountId,
            profileId: next.profileId,
            agentProvider: input.agentProvider,
          },
        });
        log.info("Notified limit with relaunch CTA", {
          sessionId: input.sessionId,
          relaunchAccountId: next.accountId,
        });
        return { kind: "notified", relaunchAccountId: next.accountId };
      }

      await this.notifyAllLimited(input);
      return { kind: "notified_all_limited" };
    }

    // mode === "auto"
    if (!next) {
      await this.notifyAllLimited(input);
      return { kind: "notified_all_limited" };
    }

    try {
      const { sessionId: newSessionId } = await this.sessionLauncher.launch({
        userId: input.userId,
        projectId: input.projectId,
        accountId: next.accountId,
        profileId: next.profileId,
        agentProvider: input.agentProvider,
        originatingSessionId: input.sessionId,
      });
      log.info("Auto-relaunched under alternate account", {
        originatingSessionId: input.sessionId,
        newSessionId,
        accountId: next.accountId,
      });
      return { kind: "relaunched", newSessionId, accountId: next.accountId };
    } catch (error) {
      // Launch failed — degrade to a notification so the user can act.
      log.warn("Auto-relaunch failed; falling back to notification", {
        sessionId: input.sessionId,
        accountId: next.accountId,
        error: String(error),
      });
      await this.notificationPort.notifyLimit({
        userId: input.userId,
        sessionId: input.sessionId,
        sessionName: input.sessionName,
        title: "Claude usage limit reached",
        body: "Auto-relaunch failed. Tap to relaunch under an available account.",
        relaunch: {
          projectId: input.projectId,
          accountId: next.accountId,
          profileId: next.profileId,
          agentProvider: input.agentProvider,
        },
      });
      return { kind: "notified", relaunchAccountId: next.accountId };
    }
  }

  /** Notify that every candidate account is limited (no relaunch CTA). */
  private async notifyAllLimited(input: RelaunchOnLimitInput): Promise<void> {
    await this.notificationPort.notifyLimit({
      userId: input.userId,
      sessionId: input.sessionId,
      sessionName: input.sessionName,
      title: "All Claude accounts limited",
      body: "Every account in the fallback pool is currently rate-limited.",
    });
    log.info("Notified all-limited", { sessionId: input.sessionId });
  }
}
