import { db } from "@/db";
import { agentStatusDeliveries, terminalSessions } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { agentStatusNotification } from "@/server/agent-callback";
import { markAgentStatusNotificationProcessed } from "@/server/agent-status-delivery";
import { createNotificationForAgentStatus } from "@/services/notification-service";
import type { AgentProviderType } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { and, eq, isNull } from "drizzle-orm";

const log = createLogger("AgentStatusNotification");

/** Longer than the hook wrapper's bounded transport retry window. */
export const STATUS_NOTIFICATION_REPAIR_GRACE_MS = 10_000;

export interface AgentStatusNotificationDeliveryInput {
  receiptId: string;
  userId: string;
  sessionId: string;
  sessionName: string;
  provider: AgentProviderType | null;
  status: AgentActivityStatus;
  focused: boolean;
}

/**
 * Materialize one receipt's durable notification intent and mark it processed
 * only after the idempotent notification transaction commits. A crash between
 * those commits is safe: the repair sweep repeats the same receipt identity.
 */
export async function deliverAgentStatusNotification(
  input: AgentStatusNotificationDeliveryInput,
  processedAt = new Date(),
) {
  const statusNotification = agentStatusNotification(input.status, input.provider);
  if (!statusNotification) {
    throw new Error(
      `status receipt ${input.receiptId} requires an unmapped ${input.status} notification`,
    );
  }

  const materialized = await createNotificationForAgentStatus(
    input.receiptId,
    {
      userId: input.userId,
      sessionId: input.sessionId,
      sessionName: input.sessionName,
      type: statusNotification.type,
      severity: statusNotification.severity,
      title: statusNotification.title,
      body: `Session "${input.sessionName}" ${statusNotification.bodySuffix}`,
      meta: {
        deepLinkSessionId: input.sessionId,
        cta: { label: "Open session", action: "open_session" },
        ...(statusNotification.result ? { result: statusNotification.result } : {}),
      },
      focused: input.focused,
    },
  );
  await markAgentStatusNotificationProcessed(input.receiptId, processedAt);
  return materialized;
}

/**
 * Drain crash-left status notification intent on terminal-server startup and
 * every liveness sweep. Fresh receipts get a grace window so the exact callback
 * can still apply focus-aware push policy and broadcast the stored row.
 */
export async function reconcileAgentStatusNotifications(
  now = new Date(),
): Promise<number> {
  const pending = await db.query.agentStatusDeliveries.findMany({
    where: and(
      eq(agentStatusDeliveries.applied, true),
      eq(agentStatusDeliveries.notificationRequired, true),
      isNull(agentStatusDeliveries.notificationProcessedAt),
    ),
    columns: {
      id: true,
      userId: true,
      sessionId: true,
      generation: true,
      status: true,
      createdAt: true,
    },
  });

  let processed = 0;
  for (const receipt of pending) {
    if (
      now.getTime() - receipt.createdAt.getTime() <
      STATUS_NOTIFICATION_REPAIR_GRACE_MS
    ) {
      continue;
    }

    const session = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, receipt.sessionId),
        eq(terminalSessions.userId, receipt.userId),
      ),
      columns: {
        id: true,
        userId: true,
        name: true,
        agentProvider: true,
      },
    });
    // A concurrently deleted session cascades its receipt. Leave an unexpected
    // orphan pending rather than falsely marking notification work complete.
    if (!session) continue;

    try {
      await deliverAgentStatusNotification({
        receiptId: receipt.id,
        userId: receipt.userId,
        sessionId: receipt.sessionId,
        sessionName: session.name,
        provider: session.agentProvider as AgentProviderType | null,
        status: receipt.status as AgentActivityStatus,
        focused: false,
      }, now);
      processed++;
    } catch (error) {
      log.error("Failed to repair status notification", {
        receiptId: receipt.id,
        sessionId: receipt.sessionId,
        generation: receipt.generation,
        error: String(error),
      });
    }
  }
  return processed;
}
