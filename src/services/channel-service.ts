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
} from "@/db/schema";
import { eq, and, sql, gt, isNull } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import type { ChannelType } from "@/types/channels";

const log = createLogger("ChannelService");

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
    if (ch) return { groupId: ch.groupId, generalChannelId: cached.id };
  }

  // Upsert the default group
  await db
    .insert(channelGroups)
    .values({ folderId, name: DEFAULT_GROUP_NAME, position: 0 })
    .onConflictDoNothing();

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
    .onConflictDoNothing();

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
    throw new Error(
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

  // Get read states for this user
  const channelIds = allChannels.map((c) => c.id);
  const readStates =
    channelIds.length > 0
      ? await db.query.channelReadState.findMany({
          where: and(
            eq(channelReadState.userId, userId),
            sql`${channelReadState.channelId} IN (${sql.join(
              channelIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        })
      : [];

  const readStateMap = new Map(readStates.map((rs) => [rs.channelId, rs]));

  // Compute unread counts per channel
  const channelsWithUnread = await Promise.all(
    allChannels.map(async (ch) => {
      const rs = readStateMap.get(ch.id);
      let unreadCount = 0;

      if (rs?.lastReadAt) {
        const result = await db
          .select({ count: sql<number>`count(*)` })
          .from(agentPeerMessages)
          .where(
            and(
              eq(agentPeerMessages.channelId, ch.id),
              isNull(agentPeerMessages.parentMessageId),
              gt(agentPeerMessages.createdAt, rs.lastReadAt)
            )
          );
        unreadCount = result[0]?.count ?? 0;
      } else {
        // Never read — count all messages
        unreadCount = ch.messageCount;
      }

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
    })
  );

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
    .onConflictDoNothing();

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
    .onConflictDoNothing()
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
 */
export async function markChannelRead(
  channelId: string,
  userId: string,
  messageId: string
) {
  const now = new Date();

  // Upsert read state
  await db
    .insert(channelReadState)
    .values({ channelId, userId, lastReadMessageId: messageId, lastReadAt: now })
    .onConflictDoUpdate({
      target: [channelReadState.channelId, channelReadState.userId],
      set: { lastReadMessageId: messageId, lastReadAt: now },
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
    throw new Error("Cannot archive the default channel");
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
