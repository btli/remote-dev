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

/**
 * Resolve @name mentions in message body to @<sid:UUID> tokens.
 * Looks up peer names in the given folder (case-insensitive, longest match first).
 * Already-tokenized mentions (@<sid:UUID>) are left untouched.
 */
async function resolveMentionsInBody(body: string, folderId: string): Promise<string> {
  if (!body.includes("@")) return body;

  // Get all agent/loop sessions in the folder
  const peers = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.folderId, folderId),
      inArray(terminalSessions.terminalType, ["agent", "loop"]),
      inArray(terminalSessions.status, ["active", "suspended"]),
    ),
    columns: { id: true, name: true },
  });

  if (peers.length === 0) return body;

  // Sort longest name first for greedy matching
  const sorted = [...peers].sort((a, b) => b.name.length - a.name.length);
  const escaped = sorted.map((p) => p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(${escaped.join("|")})(?=\\s|$|[.,;!?])`, "gi");

  return body.replace(pattern, (_match, name: string) => {
    const peer = sorted.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return peer ? `@<sid:${peer.id}>` : _match;
  });
}

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
  isUserMessage: boolean;
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

  const allPeers = await getFolderPeers(session.folderId, isConnectedFn);
  return allPeers.filter((p) => p.sessionId !== sessionId);
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

/** Convert a DB message row to a PeerMessage. */
function toMessageRow(row: {
  id: string;
  fromSessionId: string | null;
  fromSessionName: string;
  toSessionId: string | null;
  body: string;
  isUserMessage?: boolean | null;
  createdAt: Date | string | number;
}): PeerMessage {
  return {
    id: row.id,
    fromSessionId: row.fromSessionId,
    fromSessionName: row.fromSessionName,
    toSessionId: row.toSessionId,
    body: row.body,
    isUserMessage: row.isUserMessage ?? false,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export interface SendMessageResult {
  messageId: string;
  resolvedBody: string;
  senderName: string;
  folderId: string;
  userId: string;
  createdAt: string;
}

/**
 * Send a message to a specific peer or broadcast to all peers in the folder.
 */
export async function sendMessage(params: {
  fromSessionId: string;
  toSessionId?: string;
  body: string;
}): Promise<SendMessageResult> {
  const { fromSessionId, toSessionId, body } = params;

  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
  }

  const sender = await db.query.terminalSessions.findFirst({
    where: eq(terminalSessions.id, fromSessionId),
    columns: { folderId: true, name: true, userId: true },
  });

  if (!sender?.folderId || !sender.userId) {
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
  const now = new Date();
  const resolvedBody = await resolveMentionsInBody(body, sender.folderId);

  await db.insert(agentPeerMessages).values({
    id: messageId,
    folderId: sender.folderId,
    fromSessionId,
    fromSessionName: sender.name,
    toSessionId: toSessionId ?? null,
    body: resolvedBody,
    createdAt: now,
  });

  log.debug("Peer message sent", {
    messageId,
    fromSessionId,
    toSessionId: toSessionId ?? "broadcast",
    folderId: sender.folderId,
  });

  return {
    messageId,
    resolvedBody,
    senderName: sender.name,
    folderId: sender.folderId,
    userId: sender.userId,
    createdAt: now.toISOString(),
  };
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

  const rows = await db
    .select({
      id: agentPeerMessages.id,
      fromSessionId: agentPeerMessages.fromSessionId,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      body: agentPeerMessages.body,
      isUserMessage: agentPeerMessages.isUserMessage,
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

  return rows.map(toMessageRow);
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

/**
 * Send a message from the user (not from an agent session).
 * Inserts directly with fromSessionId=null and isUserMessage=true.
 */
export async function sendUserMessage(params: {
  folderId: string;
  fromName: string;
  body: string;
}): Promise<{ messageId: string; message: PeerMessage }> {
  const { folderId, fromName, body } = params;

  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
  }

  const messageId = crypto.randomUUID();
  const now = new Date();
  const resolvedBody = await resolveMentionsInBody(body, folderId);

  const row = {
    id: messageId,
    folderId,
    fromSessionId: null,
    fromSessionName: fromName,
    toSessionId: null,
    body: resolvedBody,
    isUserMessage: true,
    createdAt: now,
  };

  await db.insert(agentPeerMessages).values(row);

  log.debug("User message sent", { messageId, folderId, fromName });

  return { messageId, message: toMessageRow(row) };
}

/**
 * List all messages in a folder (for the chat room UI).
 * Unlike pollMessages, this is not session-scoped — it returns the full conversation.
 */
export async function listFolderMessages(
  folderId: string,
  limit: number = 200
): Promise<PeerMessage[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: agentPeerMessages.id,
      fromSessionId: agentPeerMessages.fromSessionId,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      body: agentPeerMessages.body,
      isUserMessage: agentPeerMessages.isUserMessage,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(agentPeerMessages)
    .where(
      and(
        eq(agentPeerMessages.folderId, folderId),
        gt(agentPeerMessages.createdAt, cutoff)
      )
    )
    .orderBy(agentPeerMessages.createdAt)
    .limit(limit);

  return rows.map(toMessageRow);
}

/**
 * List active agent peers in a folder (without requiring a calling session ID).
 * Used by the chat room UI's tab bar to show agent activity dots.
 */
export async function getFolderPeers(
  folderId: string,
  isConnectedFn?: (id: string) => boolean
): Promise<PeerInfo[]> {
  const peers = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.folderId, folderId),
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

  return peers.map((p) => {
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
