/**
 * PeerService - Folder-scoped inter-agent communication
 */

import { db } from "@/db";
import { agentPeerMessages, terminalSessions } from "@/db/schema";
import { eq, and, or, isNull, gt, inArray, sql, desc } from "drizzle-orm";
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
  channelId: string | null;
  parentMessageId: string | null;
  replyCount: number;
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
  channelId?: string | null;
  parentMessageId?: string | null;
  replyCount?: number | null;
  createdAt: Date | string | number;
}): PeerMessage {
  return {
    id: row.id,
    fromSessionId: row.fromSessionId,
    fromSessionName: row.fromSessionName,
    toSessionId: row.toSessionId,
    body: row.body,
    isUserMessage: row.isUserMessage ?? false,
    channelId: row.channelId ?? null,
    parentMessageId: row.parentMessageId ?? null,
    replyCount: row.replyCount ?? 0,
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
  channelId: string | null;
}

/**
 * Send a message to a specific peer or broadcast to all peers in the folder.
 */
export async function sendMessage(params: {
  fromSessionId: string;
  toSessionId?: string;
  body: string;
  channelId?: string;
  parentMessageId?: string;
}): Promise<SendMessageResult> {
  const { fromSessionId, toSessionId, body, channelId, parentMessageId } = params;

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

  // Resolve channel — default to #general if not specified
  const ChannelService = await import("@/services/channel-service");
  const resolvedChannelId = channelId ?? await ChannelService.getGeneralChannelId(sender.folderId);

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
    channelId: resolvedChannelId,
    parentMessageId: parentMessageId ?? null,
    createdAt: now,
  });

  // Update channel message count
  if (resolvedChannelId) {
    await ChannelService.incrementChannelMessageCount(resolvedChannelId);
  }

  // If this is a thread reply, increment parent's reply count
  if (parentMessageId) {
    await db
      .update(agentPeerMessages)
      .set({ replyCount: sql`${agentPeerMessages.replyCount} + 1` })
      .where(eq(agentPeerMessages.id, parentMessageId));
  }

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
    channelId: resolvedChannelId,
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

/** @deprecated Messages are now permanent. This function is a no-op. */
export async function cleanupOldMessages(): Promise<void> {
  log.debug("Peer message cleanup skipped (messages are permanent)");
}

/**
 * Send a message from the user (not from an agent session).
 * Inserts directly with fromSessionId=null and isUserMessage=true.
 */
export async function sendUserMessage(params: {
  folderId: string;
  fromName: string;
  body: string;
  channelId?: string;
  parentMessageId?: string;
}): Promise<{ messageId: string; message: PeerMessage }> {
  const { folderId, fromName, body, channelId, parentMessageId } = params;

  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
  }

  const ChannelService = await import("@/services/channel-service");
  const resolvedChannelId = channelId ?? await ChannelService.getGeneralChannelId(folderId);

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
    channelId: resolvedChannelId,
    parentMessageId: parentMessageId ?? null,
    createdAt: now,
  };

  await db.insert(agentPeerMessages).values(row);

  if (resolvedChannelId) {
    await ChannelService.incrementChannelMessageCount(resolvedChannelId);
  }

  if (parentMessageId) {
    await db
      .update(agentPeerMessages)
      .set({ replyCount: sql`${agentPeerMessages.replyCount} + 1` })
      .where(eq(agentPeerMessages.id, parentMessageId));
  }

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
    .where(eq(agentPeerMessages.folderId, folderId))
    .orderBy(desc(agentPeerMessages.createdAt))
    .limit(limit);

  // Reverse to chronological order
  return rows.reverse().map(toMessageRow);
}

/**
 * List messages in a specific channel (top-level only, no thread replies).
 * Cursor-based pagination using `before` timestamp.
 */
export async function listChannelMessages(
  channelId: string,
  params: { before?: Date; limit?: number } = {}
): Promise<PeerMessage[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);

  const conditions = [
    eq(agentPeerMessages.channelId, channelId),
    isNull(agentPeerMessages.parentMessageId), // top-level only
  ];

  if (params.before) {
    conditions.push(sql`${agentPeerMessages.createdAt} < ${params.before.getTime()}`);
  }

  const rows = await db
    .select({
      id: agentPeerMessages.id,
      fromSessionId: agentPeerMessages.fromSessionId,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      body: agentPeerMessages.body,
      isUserMessage: agentPeerMessages.isUserMessage,
      channelId: agentPeerMessages.channelId,
      parentMessageId: agentPeerMessages.parentMessageId,
      replyCount: agentPeerMessages.replyCount,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(agentPeerMessages)
    .where(and(...conditions))
    .orderBy(desc(agentPeerMessages.createdAt))
    .limit(limit);

  // Reverse to chronological order
  return rows.reverse().map(toMessageRow);
}

/**
 * List replies to a specific message (thread).
 */
export async function listThreadReplies(
  parentMessageId: string,
  limit: number = 100
): Promise<PeerMessage[]> {
  const rows = await db
    .select({
      id: agentPeerMessages.id,
      fromSessionId: agentPeerMessages.fromSessionId,
      fromSessionName: agentPeerMessages.fromSessionName,
      toSessionId: agentPeerMessages.toSessionId,
      body: agentPeerMessages.body,
      isUserMessage: agentPeerMessages.isUserMessage,
      channelId: agentPeerMessages.channelId,
      parentMessageId: agentPeerMessages.parentMessageId,
      replyCount: agentPeerMessages.replyCount,
      createdAt: agentPeerMessages.createdAt,
    })
    .from(agentPeerMessages)
    .where(eq(agentPeerMessages.parentMessageId, parentMessageId))
    .orderBy(agentPeerMessages.createdAt)
    .limit(Math.min(limit, 500));

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
