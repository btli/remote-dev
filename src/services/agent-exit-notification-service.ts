import { agentExitDeliveryId } from "@/server/agent-callback";
import * as NotificationService from "@/services/notification-service";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { withBusyRetry } from "@/db/busy-retry";

export interface AgentExitNotificationIntent {
  id: string;
  userId: string;
  name: string;
  generation: number;
  exitCode: number | null;
  signal?: string | null;
  /** Used when a signal was observed but an older schema could not persist it. */
  failed?: boolean;
  focused?: boolean;
  /** Replace a prior heuristic notification for this generation in place. */
  enrichExisting?: boolean;
}

export async function ensureAgentStuckNotification(
  intent: Pick<AgentExitNotificationIntent, "id" | "userId" | "name" | "generation" | "focused">,
) {
  return NotificationService.createNotification({
    userId: intent.userId,
    sessionId: intent.id,
    sessionName: intent.name,
    type: "agent_stuck",
    severity: "error",
    title: "Agent stopped responding",
    body: `Session "${intent.name}" was active but its process is gone.`,
    meta: {
      deepLinkSessionId: intent.id,
      cta: { label: "Open session", action: "open_session" },
      result: "unknown",
    },
    focused: intent.focused ?? false,
    idempotencyKey: agentExitDeliveryId(intent.id, intent.generation),
  });
}

/**
 * Materialize the durable notification implied by an exited session row.
 * Its deterministic identity makes this safe from the callback, liveness
 * reconciliation, and crash-repair scans simultaneously.
 */
export async function ensureAgentExitNotification(intent: AgentExitNotificationIntent) {
  const signal = intent.signal ?? null;
  const failed = intent.failed ?? (signal !== null || intent.exitCode !== 0);
  const resultLabel = signal ?? (failed ? String(intent.exitCode ?? "unknown") : "success");
  const input = {
    userId: intent.userId,
    sessionId: intent.id,
    sessionName: intent.name,
    type: failed ? "agent_error" : "agent_exited",
    severity: failed ? "error" : "passive",
    title: failed ? "Agent process exited with an error" : "Agent session completed",
    body: failed
      ? signal
        ? `Session "${intent.name}" exited from signal ${signal}`
        : intent.exitCode === null
          ? `Session "${intent.name}" exited unexpectedly`
          : `Session "${intent.name}" exited with code ${intent.exitCode}`
      : `Session "${intent.name}" finished`,
    meta: {
      deepLinkSessionId: intent.id,
      cta: { label: "Open session", action: "open_session" },
      result: resultLabel,
    },
    focused: intent.focused ?? false,
    idempotencyKey: agentExitDeliveryId(intent.id, intent.generation),
  } as const;
  return intent.enrichExisting
    ? NotificationService.replaceIdempotentNotification(input)
    : NotificationService.createNotification(input);
}

/** Mark the durable exit intent fulfilled after notification storage succeeds. */
export async function markAgentExitNotificationDelivered(
  intent: Pick<AgentExitNotificationIntent, "id" | "userId" | "generation">,
): Promise<void> {
  await withBusyRetry(() => db
    .update(terminalSessions)
    .set({ agentExitNotificationAt: new Date() })
    .where(and(
      eq(terminalSessions.id, intent.id),
      eq(terminalSessions.userId, intent.userId),
      eq(terminalSessions.agentExitState, "exited"),
      sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${intent.generation}`,
    )), { label: "mark agent exit notification delivered" });
}
