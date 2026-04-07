/**
 * ChannelService - Channel and group lifecycle management
 *
 * Handles creation, listing, and management of chat channels and groups.
 * Channels are folder-scoped and organized into groups.
 */

import { db } from "@/db";
import {
  channelGroups,
  channels,
  channelReadState,
  agentPeerMessages,
  sessionFolders,
} from "@/db/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import type { ChannelType } from "@/types/channels";

const log = createLogger("ChannelService");

export class ChannelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelValidationError";
  }
}

export class ChannelArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelArchiveError";
  }
}

const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const DEFAULT_GROUP_NAME = "Channels";
const DM_GROUP_NAME = "Direct Messages";
const GENERAL_CHANNEL_NAME = "general";

/** Cache for general channel IDs to avoid repeated lookups. */
const generalChannelCache = new Map<string, { id: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Ensure a folder has the default "Channels" group and "#general" channel.
 * Idempotent — safe to call multiple times and concurrently.
 */
export async function ensureFolderChannels(
  folderId: string
): Promise<{ groupId: string; generalChannelId: string }> {
  // Check cache first
  const cached = generalChannelCache.get(folderId);
  if (cached && cached.expiresAt > Date.now()) {
    const ch = await db.query.channels.findFirst({
      where: eq(channels.id, cached.id),
      columns: { groupId: true },
    });
    if (ch) {
      // Refresh cache expiry
      cached.expiresAt = Date.now() + CACHE_TTL_MS;
      return { groupId: ch.groupId, generalChannelId: cached.id };
    } else {
      // Channel was deleted — evict stale cache
      generalChannelCache.delete(folderId);
    }
  }

  // Upsert the default group
  await db
    .insert(channelGroups)
    .values({ folderId, name: DEFAULT_GROUP_NAME, position: 0 })
    .onConflictDoNothing({ target: [channelGroups.folderId, channelGroups.name] });

  const group = await db.query.channelGroups.findFirst({
    where: and(
      eq(channelGroups.folderId, folderId),
      eq(channelGroups.name, DEFAULT_GROUP_NAME)
    ),
    columns: { id: true },
  });

  if (!group) {
    throw new Error(`Failed to ensure default group for folder ${folderId}`);
  }

  // Upsert the #general channel
  await db
    .insert(channels)
    .values({
      folderId,
      groupId: group.id,
      name: GENERAL_CHANNEL_NAME,
      displayName: "#general",
      type: "public",
      isDefault: true,
    })
    .onConflictDoNothing({ target: [channels.folderId, channels.name] });

  const general = await db.query.channels.findFirst({
    where: and(
      eq(channels.folderId, folderId),
      eq(channels.name, GENERAL_CHANNEL_NAME)
    ),
    columns: { id: true },
  });

  if (!general) {
    throw new Error(`Failed to ensure #general channel for folder ${folderId}`);
  }

  // Update cache
  generalChannelCache.set(folderId, {
    id: general.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  log.debug("Folder channels ensured", { folderId, generalChannelId: general.id });
  return { groupId: group.id, generalChannelId: general.id };
}

/**
 * Get the #general channel ID for a folder (cached).
 */
export async function getGeneralChannelId(folderId: string): Promise<string> {
  const { generalChannelId } = await ensureFolderChannels(folderId);
  return generalChannelId;
}

// ─── Channel CRUD ───────────────────────────────────────────────────────────

export interface CreateChannelParams {
  folderId: string;
  groupId?: string;
  name: string;
  displayName?: string;
  topic?: string;
  type?: ChannelType;
  createdBySessionId?: string;
}

/**
 * Create a new channel in a folder.
 * If no groupId is provided, uses the default "Channels" group.
 */
export async function createChannel(params: CreateChannelParams) {
  const { folderId, name, topic, type = "public", createdBySessionId } = params;

  if (!CHANNEL_NAME_RE.test(name)) {
    throw new ChannelValidationError(
      `Invalid channel name "${name}". Must be 1-50 chars, lowercase alphanumeric and hyphens, starting with alphanumeric.`
    );
  }

  // Ensure default group exists and use it if no groupId specified
  let groupId = params.groupId;
  if (!groupId) {
    const { groupId: defaultGroupId } = await ensureFolderChannels(folderId);
    groupId = defaultGroupId;
  }

  const displayName = params.displayName || `#${name}`;

  const [channel] = await db
    .insert(channels)
    .values({
      folderId,
      groupId,
      name,
      displayName,
      type,
      topic,
      createdBySessionId,
    })
    .returning();

  log.info("Channel created", { channelId: channel.id, name, folderId });
  return channel;
}

/**
 * List all channel groups with nested channels for a folder.
 * Includes unread counts for the given user.
 */
export async function listChannelGroups(
  folderId: string,
  userId: string
) {
  // Ensure defaults exist
  await ensureFolderChannels(folderId);

  const groups = await db.query.channelGroups.findMany({
    where: eq(channelGroups.folderId, folderId),
    orderBy: channelGroups.position,
  });

  const allChannels = await db.query.channels.findMany({
    where: and(
      eq(channels.folderId, folderId),
      isNull(channels.archivedAt)
    ),
    orderBy: channels.createdAt,
  });

  // Batch: get read states for all channels in one query
  const channelIds = allChannels.map((c) => c.id);
  const readStates =
    channelIds.length > 0
      ? await db
          .select({
            channelId: channelReadState.channelId,
            lastReadAt: channelReadState.lastReadAt,
          })
          .from(channelReadState)
          .where(
            and(
              eq(channelReadState.userId, userId),
              inArray(channelReadState.channelId, channelIds)
            )
          )
      : [];

  const readStateMap = new Map(readStates.map((rs) => [rs.channelId, rs.lastReadAt]));

  // Batch: count unread messages per channel since each channel's last-read timestamp
  const channelsWithReadState = allChannels
    .filter((c) => readStateMap.has(c.id))
    .map((c) => ({ id: c.id, lastReadAt: readStateMap.get(c.id)! }));

  const unreadCountMap = new Map<string, number>();

  if (channelsWithReadState.length > 0) {
    const unreadRows = await db
      .select({
        channelId: agentPeerMessages.channelId,
        count: sql<number>`count(*)`,
      })
      .from(agentPeerMessages)
      .where(
        sql`${agentPeerMessages.channelId} IN (${sql.join(
          channelsWithReadState.map((c) => sql`${c.id}`),
          sql`, `
        )}) AND ${agentPeerMessages.parentMessageId} IS NULL AND (${sql.join(
          channelsWithReadState.map(
            (c) =>
              sql`(${agentPeerMessages.channelId} = ${c.id} AND ${agentPeerMessages.createdAt} > ${c.lastReadAt.getTime()})`
          ),
          sql` OR `
        )})`
      )
      .groupBy(agentPeerMessages.channelId);

    for (const row of unreadRows) {
      if (row.channelId) unreadCountMap.set(row.channelId, row.count);
    }
  }

  // For never-read channels, count only top-level messages (not thread replies)
  const neverReadIds = allChannels.filter((c) => !readStateMap.has(c.id)).map((c) => c.id);
  const neverReadCountMap = new Map<string, number>();
  if (neverReadIds.length > 0) {
    const neverReadRows = await db
      .select({
        channelId: agentPeerMessages.channelId,
        count: sql<number>`count(*)`,
      })
      .from(agentPeerMessages)
      .where(
        and(
          inArray(agentPeerMessages.channelId, neverReadIds),
          isNull(agentPeerMessages.parentMessageId)
        )
      )
      .groupBy(agentPeerMessages.channelId);
    for (const row of neverReadRows) {
      if (row.channelId) neverReadCountMap.set(row.channelId, row.count);
    }
  }

  const channelsWithUnread = allChannels.map((ch) => {
    const lastReadAt = readStateMap.get(ch.id);
    // Never read → count top-level messages only; otherwise use the batched count
    const unreadCount = lastReadAt
      ? (unreadCountMap.get(ch.id) ?? 0)
      : (neverReadCountMap.get(ch.id) ?? 0);

    return {
      id: ch.id,
      folderId: ch.folderId,
      groupId: ch.groupId,
      name: ch.name,
      displayName: ch.displayName,
      type: ch.type as ChannelType,
      topic: ch.topic,
      isDefault: ch.isDefault,
      lastMessageAt: ch.lastMessageAt?.toISOString() ?? null,
      messageCount: ch.messageCount,
      unreadCount,
      createdAt: ch.createdAt.toISOString(),
    };
  });

  return groups.map((g) => ({
    id: g.id,
    folderId: g.folderId,
    name: g.name,
    position: g.position,
    channels: channelsWithUnread.filter((c) => c.groupId === g.id),
  }));
}

/**
 * Get a single channel by ID.
 */
export async function getChannel(channelId: string) {
  return db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });
}

/**
 * Verify a channel belongs to a specific folder.
 */
export async function verifyChannelInFolder(
  channelId: string,
  folderId: string
): Promise<boolean> {
  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.id, channelId), eq(channels.folderId, folderId)),
    columns: { id: true },
  });
  return !!ch;
}

// ─── Access Checks (shared by API routes) ────────────────────────────────────

/**
 * Verify the user owns the folder containing a channel.
 * Returns the folderId on success, or null if the channel doesn't exist
 * or the user doesn't own the folder.
 */
export async function verifyChannelAccess(
  channelId: string,
  userId: string
): Promise<{ folderId: string } | null> {
  const channel = await getChannel(channelId);
  if (!channel) return null;

  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, channel.folderId),
      eq(sessionFolders.userId, userId)
    ),
    columns: { id: true },
  });
  if (!folder) return null;

  return { folderId: channel.folderId };
}

/**
 * Verify the user owns the given folder.
 */
export async function verifyFolderOwnership(
  folderId: string,
  userId: string
): Promise<boolean> {
  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, folderId),
      eq(sessionFolders.userId, userId)
    ),
    columns: { id: true },
  });
  return !!folder;
}

/**
 * Find or create a DM channel between two sessions.
 * DM channel names are deterministic: `dm-{minId8}-{maxId8}` for idempotency.
 */
export async function findOrCreateDmChannel(
  folderId: string,
  sessionIdA: string,
  sessionIdB: string
) {
  const [minId, maxId] = [sessionIdA, sessionIdB].sort();
  const dmName = `dm-${minId.slice(0, 8)}-${maxId.slice(0, 8)}`;

  // Check if already exists
  const existing = await db.query.channels.findFirst({
    where: and(eq(channels.folderId, folderId), eq(channels.name, dmName)),
  });
  if (existing) return existing;

  // Ensure DM group exists
  await db
    .insert(channelGroups)
    .values({ folderId, name: DM_GROUP_NAME, position: 100 })
    .onConflictDoNothing({ target: [channelGroups.folderId, channelGroups.name] });

  const dmGroup = await db.query.channelGroups.findFirst({
    where: and(
      eq(channelGroups.folderId, folderId),
      eq(channelGroups.name, DM_GROUP_NAME)
    ),
    columns: { id: true },
  });

  if (!dmGroup) throw new Error("Failed to create DM group");

  const [channel] = await db
    .insert(channels)
    .values({
      folderId,
      groupId: dmGroup.id,
      name: dmName,
      displayName: dmName, // Will be resolved to peer name at render time
      type: "dm",
    })
    .onConflictDoNothing({ target: [channels.folderId, channels.name] })
    .returning();

  // Handle race condition: if onConflictDoNothing fired, re-query
  if (!channel) {
    const raced = await db.query.channels.findFirst({
      where: and(eq(channels.folderId, folderId), eq(channels.name, dmName)),
    });
    if (!raced) throw new Error("Failed to create DM channel");
    return raced;
  }

  log.info("DM channel created", { channelId: channel.id, folderId });
  return channel;
}

// ─── Read State ─────────────────────────────────────────────────────────────

/**
 * Mark a channel as read for a user up to a specific message.
 * Uses the message's actual createdAt timestamp for consistency.
 */
export async function markChannelRead(
  channelId: string,
  userId: string,
  messageId: string
) {
  // Verify message belongs to this channel and get its timestamp
  const message = await db.query.agentPeerMessages.findFirst({
    where: and(
      eq(agentPeerMessages.id, messageId),
      eq(agentPeerMessages.channelId, channelId)
    ),
    columns: { id: true, createdAt: true },
  });
  if (!message) {
    throw new Error("Message does not belong to this channel");
  }

  const lastReadAt = message.createdAt ?? new Date();

  // Upsert read state
  await db
    .insert(channelReadState)
    .values({ channelId, userId, lastReadMessageId: messageId, lastReadAt })
    .onConflictDoUpdate({
      target: [channelReadState.channelId, channelReadState.userId],
      set: { lastReadMessageId: messageId, lastReadAt },
    });
}

/**
 * Archive a channel (soft delete). Cannot archive default channels.
 */
export async function archiveChannel(channelId: string) {
  const ch = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
    columns: { isDefault: true },
  });
  if (ch?.isDefault) {
    throw new ChannelArchiveError("Cannot archive the default channel");
  }

  await db
    .update(channels)
    .set({ archivedAt: new Date() })
    .where(eq(channels.id, channelId));

  log.info("Channel archived", { channelId });
}

/**
 * Increment message count and update lastMessageAt on a channel.
 * Called after inserting a message.
 */
export async function incrementChannelMessageCount(channelId: string) {
  await db
    .update(channels)
    .set({
      messageCount: sql`${channels.messageCount} + 1`,
      lastMessageAt: new Date(),
    })
    .where(eq(channels.id, channelId));
}
