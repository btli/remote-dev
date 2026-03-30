/**
 * PeerService - Folder-scoped inter-agent communication
 */

import { db } from "@/db";
import { agentPeerMessages, terminalSessions } from "@/db/schema";
import { eq, and, or, isNull, gt, inArray, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { safeJsonParse } from "@/lib/utils";

const log = createLogger("PeerService");

const MAX_MESSAGE_LENGTH = 8192;

export interface PeerInfo {
  sessionId: string;
  name: string;
  agentProvider: string | null;
  agentActivityStatus: string | null;
  peerSummary: string | null;
  claudeSessionId: string | null;
  isConnected: boolean;
}

export interface PeerMessage {
  id: string;
  fromSessionId: string | null;
  fromSessionName: string;
  toSessionId: string | null;
  body: string;
  createdAt: string;
}

/**
 * List active agent peers in the same folder as the given session.
 * The requesting session is excluded from results.
 */
export async function getPeers(
  sessionId: string,
  isConnectedFn?: (id: string) => boolean
): Promise<PeerInfo[]> {
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: { folderId: true },
  });

  if (!session?.folderId) {
    return [];
  }

  const peers = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.folderId, session.folderId),
      inArray(terminalSessions.terminalType, ["agent", "loop"]),
      inArray(terminalSessions.status, ["active", "suspended"]),
    ),
    columns: {
      id: true,
      name: true,
      agentProvider: true,
      agentActivityStatus: true,
      typeMetadata: true,
    },
  });

  return peers
    .filter((p) => p.id !== sessionId)
    .map((p) => {
      const agentMeta = parseAgentMeta(p.typeMetadata);
      return {
        sessionId: p.id,
        name: p.name,
        agentProvider: p.agentProvider,
        agentActivityStatus: p.agentActivityStatus,
        peerSummary: agentMeta.peerSummary,
        claudeSessionId: agentMeta.claudeSessionId,
        isConnected: isConnectedFn ? isConnectedFn(p.id) : false,
      };
    });
}

/** Extract agent metadata fields from typeMetadata JSON. */
function parseAgentMeta(typeMetadata: string | null): {
  peerSummary: string | null;
  claudeSessionId: string | null;
} {
  const meta = safeJsonParse<Record<string, unknown>>(typeMetadata, {});
  return {
    peerSummary: (meta.peerSummary as string) ?? null,
    claudeSessionId: (meta.claudeSessionId as string) ?? null,
  };
}

/**
 * Send a message to a specific peer or broadcast to all peers in the folder.
 */
export async function sendMessage(params: {
  fromSessionId: string;
  toSessionId?: string;
  body: string;
}): Promise<{ messageId: string }> {
  const { fromSessionId, toSessionId, body } = params;

  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
  }

  const sender = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, fromSessionId),
    columns: { folderId: true, name: true },
  });

  if (!sender?.folderId) {
    throw new Error("Sender session not found or has no folder");
  }

  if (toSessionId) {
    const recipient = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, toSessionId),
      columns: { folderId: true },
    });

    if (!recipient || recipient.folderId !== sender.folderId) {
      throw new Error("Recipient session not found or not in the same folder");
    }
  }

  const messageId = crypto.randomUUID();

  await db.insert(agentPeerMessages).values({
    id: messageId,
    folderId: sender.folderId,
    fromSessionId,
    fromSessionName: sender.name,
    toSessionId: toSessionId ?? null,
    body,
  });

  log.debug("Peer message sent", {
    messageId,
    fromSessionId,
    toSessionId: toSessionId ?? "broadcast",
    folderId: sender.folderId,
  });

  return { messageId };
}

/**
 * Poll for new messages addressed to a session (direct or broadcast).
 */
export async function pollMessages(
  sessionId: string,
  since: Date
): Promise<PeerMessage[]> {
  const session = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, sessionId),
    columns: { folderId: true },
  });

  if (!session?.folderId) {
    return [];
  }

  const messages = await db
    .select({
      id: agentPeerMessages.id,
      fromSessionId: agentPeerMessages.fromSessionId,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      body: agentPeerMessages.body,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(agentPeerMessages)
    .where(
      and(
        eq(agentPeerMessages.folderId, session.folderId),
        gt(agentPeerMessages.createdAt, since),
        // Direct messages to this session OR broadcasts (toSessionId IS NULL)
        or(
          eq(agentPeerMessages.toSessionId, sessionId),
          isNull(agentPeerMessages.toSessionId)
        ),
        // Exclude messages from self (handle NULL fromSessionId from deleted sessions)
        or(
          isNull(agentPeerMessages.fromSessionId),
          sql`${agentPeerMessages.fromSessionId} != ${sessionId}`
        )
      )
    )
    .orderBy(agentPeerMessages.createdAt);

  return messages.map((m) => ({
    id: m.id,
    fromSessionId: m.fromSessionId,
    fromSessionName: m.fromSessionName,
    toSessionId: m.toSessionId,
    body: m.body,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  }));
}

/**
 * Set the peer summary for a session (stored in typeMetadata).
 * Uses a transaction to avoid race conditions with other typeMetadata writers.
 */
export async function setSummary(
  sessionId: string,
  summary: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await tx.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
      columns: { typeMetadata: true },
    });

    const metadata = safeJsonParse<Record<string, unknown>>(session?.typeMetadata, {});
    metadata.peerSummary = summary;

    await tx
      .update(terminalSessions)
      .set({ typeMetadata: JSON.stringify(metadata) })
      .where(eq(terminalSessions.id, sessionId));
  });

  log.debug("Peer summary updated", { sessionId, summary });
}

/** Delete peer messages older than 24 hours. */
export async function cleanupOldMessages(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await db
    .delete(agentPeerMessages)
    .where(sql`${agentPeerMessages.createdAt} < ${cutoff.getTime()}`);

  log.debug("Peer message cleanup complete");
}
