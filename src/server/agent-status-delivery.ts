import { db } from "@/db";
import { agentStatusDeliveries, terminalSessions } from "@/db/schema";
import { agentStatusDeliveryId } from "@/server/agent-callback";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface AgentStatusDeliveryInput {
  sessionId: string;
  userId: string;
  generation: number;
  deliveryId: string;
  status: AgentActivityStatus;
  source: string | null;
  /** Whether this accepted semantic status requires durable notification work. */
  notificationRequired: boolean;
  /** Epoch milliseconds captured synchronously at HTTP request arrival. */
  statusAt: number;
  /** Strict monotonic token captured beside statusAt, before authentication. */
  arrivalOrder: number;
}

export interface AgentStatusDeliveryResult {
  disposition: "apply" | "retry" | "ignore";
  receiptId: string;
  applied: boolean;
  isCurrent: boolean;
  statusAt: number;
  /** Canonical semantics from the first request accepted for this identity. */
  status: AgentActivityStatus;
  source: string | null;
  notificationRequired: boolean;
}

/** True only while the receipt still owns the session's visible activity state. */
async function receiptIsCurrent(
  database: typeof db,
  receipt: typeof agentStatusDeliveries.$inferSelect,
): Promise<boolean> {
  if (!receipt.applied) return false;
  const current = await database.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, receipt.sessionId),
      eq(terminalSessions.userId, receipt.userId),
    ),
    columns: {
      agentRestartCount: true,
      agentActivityStatus: true,
      agentActivityOrder: true,
    },
  });
  return Boolean(
    current &&
      (current.agentRestartCount ?? 0) === receipt.generation &&
      current.agentActivityStatus === receipt.status &&
      current.agentActivityOrder === receipt.arrivalOrder,
  );
}

/**
 * Atomically record a stable delivery identity and apply its status at most
 * once. Exact retries can still repair downstream notification storage, but
 * they never rewrite or rebroadcast activity state.
 */
export async function applyAgentStatusDelivery(
  input: AgentStatusDeliveryInput,
): Promise<AgentStatusDeliveryResult> {
  const receiptId = agentStatusDeliveryId(
    input.sessionId,
    input.generation,
    input.deliveryId,
    input.status,
  );

  return db.transaction(async (tx) => {
    const database = tx as unknown as typeof db;
    const [inserted] = await database
      .insert(agentStatusDeliveries)
      .values({
        id: receiptId,
        userId: input.userId,
        sessionId: input.sessionId,
        generation: input.generation,
        deliveryId: input.deliveryId,
        status: input.status,
        source: input.source,
        statusAt: input.statusAt,
        arrivalOrder: input.arrivalOrder,
        applied: false,
        notificationRequired: input.notificationRequired,
      })
      .onConflictDoNothing({ target: agentStatusDeliveries.id })
      .returning();

    if (!inserted) {
      const receipt = await database.query.agentStatusDeliveries.findFirst({
        where: eq(agentStatusDeliveries.id, receiptId),
      });
      if (!receipt) {
        throw new Error(`status receipt ${receiptId} disappeared after conflict`);
      }
      return {
        disposition: "retry" as const,
        receiptId,
        applied: receipt.applied,
        isCurrent: await receiptIsCurrent(database, receipt),
        statusAt: receipt.statusAt,
        status: receipt.status as AgentActivityStatus,
        source: receipt.source,
        notificationRequired: receipt.notificationRequired,
      };
    }

    const guards = [
      eq(terminalSessions.id, input.sessionId),
      eq(terminalSessions.userId, input.userId),
      sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${input.generation}`,
      sql`(${terminalSessions.agentExitState} IS NULL OR ${terminalSessions.agentExitState} IN ('running', 'restarting'))`,
      sql`(${terminalSessions.agentActivityOrder} IS NULL OR ${terminalSessions.agentActivityOrder} < ${input.arrivalOrder})`,
    ];
    if (input.source === "subagent-stop" && input.status === "running") {
      guards.push(
        sql`(${terminalSessions.agentActivityStatus} IS NULL OR ${terminalSessions.agentActivityStatus} NOT IN ('idle', 'ended'))`,
      );
    }

    const updated = await database
      .update(terminalSessions)
      .set({
        agentActivityStatus: input.status,
        agentActivityStatusAt: input.statusAt,
        agentActivityOrder: input.arrivalOrder,
      })
      .where(and(...guards))
      .returning({ id: terminalSessions.id });
    const applied = updated.length > 0;
    await database
      .update(agentStatusDeliveries)
      .set({ applied })
      .where(eq(agentStatusDeliveries.id, receiptId));

    return {
      disposition: applied ? "apply" as const : "ignore" as const,
      receiptId,
      applied,
      isCurrent: applied,
      statusAt: input.statusAt,
      status: input.status,
      source: input.source,
      notificationRequired: input.notificationRequired,
    };
  });
}

/** Mark durable notification intent handled after its idempotent transaction. */
export async function markAgentStatusNotificationProcessed(
  receiptId: string,
  processedAt = new Date(),
): Promise<void> {
  await db
    .update(agentStatusDeliveries)
    .set({ notificationProcessedAt: processedAt })
    .where(and(
      eq(agentStatusDeliveries.id, receiptId),
      eq(agentStatusDeliveries.applied, true),
      eq(agentStatusDeliveries.notificationRequired, true),
      isNull(agentStatusDeliveries.notificationProcessedAt),
    ));
}

/** Re-check before materializing attention so a newer status can obsolete it. */
export async function isAgentStatusDeliveryCurrent(receiptId: string): Promise<boolean> {
  const receipt = await db.query.agentStatusDeliveries.findFirst({
    where: eq(agentStatusDeliveries.id, receiptId),
  });
  return receipt ? receiptIsCurrent(db, receipt) : false;
}
