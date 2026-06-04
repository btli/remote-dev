/**
 * MessageDeliveryService — durable per-recipient inbox for agent messages.
 *
 * [x386.1] The `agent_peer_message` table has no per-recipient delivery state,
 * so a dropped MCP push is lost forever (the poll was the only recovery, and it
 * had no durable cursor). This service records one `message_delivery` row per
 * (message, recipient) and advances it through a state machine:
 *
 *   pending → delivered → acked
 *
 * `pending`   the row exists but nothing has been pushed yet.
 * `delivered` the message was pushed to a live MCP socket OR returned by a poll.
 * `acked`     the MCP server (or CLI) confirmed it surfaced to the agent.
 *
 * Replay is driven entirely by the `state != 'acked'` filter (see
 * `getUndelivered`): a reconnecting MCP server or poll asks for the rows it has
 * not yet acked, so the delivery state IS the cursor. (An earlier
 * `message_replay_cursor` table tracked the highest acked timestamp as a
 * defense-in-depth lower bound, but nothing ever read it to drive behavior, so
 * it was removed as dead infrastructure — bd remote-dev-x386.16.)
 */

import { db } from "@/db";
import { messageDelivery, agentPeerMessages } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("MessageDelivery");

/** How a delivery reached the agent (parity metrics + debugging). */
export type DeliveryChannel = "mcp_push" | "poll";

/** An undelivered (pending|delivered, not acked) message row for a session. */
export interface UndeliveredMessage {
  /** The agent_peer_message id (NOT the delivery row id). */
  id: string;
  state: "pending" | "delivered" | "acked";
  body: string;
  fromSessionName: string;
  toSessionId: string | null;
  channelId: string | null;
  parentMessageId: string | null;
  createdAt: Date;
}

/**
 * Create one pending delivery row per recipient. Idempotent via the unique
 * (message_id, to_session_id) index — calling twice yields one row per pair.
 */
export async function recordDeliveries(
  messageId: string,
  projectId: string,
  recipientSessionIds: string[],
): Promise<void> {
  if (recipientSessionIds.length === 0) return;
  // De-dup the input so a caller passing the same recipient twice doesn't
  // trip the unique index within a single insert batch (SQLite rejects the
  // whole statement on an in-batch conflict even with onConflictDoNothing).
  const unique = [...new Set(recipientSessionIds)];
  await db
    .insert(messageDelivery)
    .values(unique.map((toSessionId) => ({ messageId, toSessionId, projectId })))
    .onConflictDoNothing({
      target: [messageDelivery.messageId, messageDelivery.toSessionId],
    });
}

/**
 * Mark a (message, session) delivered via a given channel. No-op if the row is
 * already `acked` (delivery must never regress an ack).
 */
export async function markDelivered(
  messageId: string,
  sessionId: string,
  via: DeliveryChannel,
): Promise<void> {
  await db
    .update(messageDelivery)
    .set({ state: "delivered", channelType: via, deliveredAt: new Date() })
    .where(
      and(
        eq(messageDelivery.messageId, messageId),
        eq(messageDelivery.toSessionId, sessionId),
        sql`${messageDelivery.state} != 'acked'`,
      ),
    );
}

/**
 * Confirm the agent surfaced the message: advance its delivery row to `acked`.
 * The `acked` state is itself the replay cursor — once set, `getUndelivered`'s
 * `state != 'acked'` filter never returns the row again.
 */
export async function ackDelivery(messageId: string, sessionId: string): Promise<void> {
  await db
    .update(messageDelivery)
    .set({ state: "acked", ackedAt: new Date() })
    .where(
      and(
        eq(messageDelivery.messageId, messageId),
        eq(messageDelivery.toSessionId, sessionId),
      ),
    );
}

/**
 * Ack many (message, session) deliveries for one session. Used by the poll
 * fallback (`/internal/peers/ack-batch`) so non-MCP providers reach the same
 * exactly-once guarantee as the MCP push path.
 */
export async function ackDeliveries(messageIds: string[], sessionId: string): Promise<void> {
  for (const messageId of messageIds) {
    await ackDelivery(messageId, sessionId);
  }
}

/**
 * Undelivered (pending|delivered, not acked) messages for a session, oldest
 * first. Joins the message body so callers can render/push without a second
 * query. This is the single set both the MCP replay handshake and the CLI poll
 * read from.
 */
export async function getUndelivered(
  sessionId: string,
  limit = 50,
): Promise<UndeliveredMessage[]> {
  const rows = await db
    .select({
      id: messageDelivery.messageId,
      state: messageDelivery.state,
      body: agentPeerMessages.body,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      channelId: agentPeerMessages.channelId,
      parentMessageId: agentPeerMessages.parentMessageId,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(messageDelivery)
    .innerJoin(agentPeerMessages, eq(messageDelivery.messageId, agentPeerMessages.id))
    .where(
      and(
        eq(messageDelivery.toSessionId, sessionId),
        sql`${messageDelivery.state} != 'acked'`,
      ),
    )
    .orderBy(agentPeerMessages.createdAt)
    .limit(limit);
  return rows;
}

// Re-export the logger namespace name for callers that want to assert/log the
// delivery channel without importing the table. (Keeps mcp-push.ts loosely
// coupled — it installs a hook rather than importing this module directly.)
export { log as _deliveryLog };
