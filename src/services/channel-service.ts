/**
 * ChannelService - Channel and group lifecycle management
 *
 * Handles creation, listing, and management of chat channels and groups.
 * Channels are project-scoped and organized into groups.
 */

import { db, client } from "@/db";
import {
  channelGroups,
  channels,
  channelReadState,
  agentPeerMessages,
  projects,
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
 * Ensure a project has the default "Channels" group and "#general" channel.
 * Idempotent — safe to call multiple times and concurrently.
 */
export async function ensureProjectChannels(
  projectId: string
): Promise<{ groupId: string; generalChannelId: string }> {
  // Check cache first
  const cached = generalChannelCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) {
    const ch = await db.query.channels.findFirst({
      where: eq(channels.id, cached.id),
      columns: { groupId: true },
    });
    if (ch) {
      cached.expiresAt = Date.now() + CACHE_TTL_MS;
      return { groupId: ch.groupId, generalChannelId: cached.id };
    } else {
      generalChannelCache.delete(projectId);
    }
  }

  // Upsert the default group
  await db
    .insert(channelGroups)
    .values({ projectId, name: DEFAULT_GROUP_NAME, position: 0 })
    .onConflictDoNothing({ target: [channelGroups.projectId, channelGroups.name] });

  const group = await db.query.channelGroups.findFirst({
    where: and(
      eq(channelGroups.projectId, projectId),
      eq(channelGroups.name, DEFAULT_GROUP_NAME)
    ),
    columns: { id: true },
  });

  if (!group) {
    throw new Error(`Failed to ensure default group for project ${projectId}`);
  }

  // Upsert the #general channel
  await db
    .insert(channels)
    .values({
      projectId,
      groupId: group.id,
      name: GENERAL_CHANNEL_NAME,
      displayName: "#general",
      type: "public",
      isDefault: true,
    })
    .onConflictDoNothing({ target: [channels.projectId, channels.name] });

  const general = await db.query.channels.findFirst({
    where: and(
      eq(channels.projectId, projectId),
      eq(channels.name, GENERAL_CHANNEL_NAME)
    ),
    columns: { id: true },
  });

  if (!general) {
    throw new Error(`Failed to ensure #general channel for project ${projectId}`);
  }

  generalChannelCache.set(projectId, {
    id: general.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  log.debug("Project channels ensured", { projectId, generalChannelId: general.id });
  return { groupId: group.id, generalChannelId: general.id };
}

/** @deprecated Use {@link ensureProjectChannels}. */
export const ensureFolderChannels = ensureProjectChannels;

/**
 * Get the #general channel ID for a project (cached).
 */
export async function getGeneralChannelId(projectId: string): Promise<string> {
  const { generalChannelId } = await ensureProjectChannels(projectId);
  return generalChannelId;
}

// ─── Channel CRUD ───────────────────────────────────────────────────────────

export interface CreateChannelParams {
  projectId: string;
  groupId?: string;
  name: string;
  displayName?: string;
  topic?: string;
  type?: ChannelType;
  createdBySessionId?: string;
}

/**
 * Create a new channel in a project.
 * If no groupId is provided, uses the default "Channels" group.
 */
export async function createChannel(params: CreateChannelParams) {
  const { projectId, name, topic, type = "public", createdBySessionId } = params;

  if (!CHANNEL_NAME_RE.test(name)) {
    throw new ChannelValidationError(
      `Invalid channel name "${name}". Must be 1-50 chars, lowercase alphanumeric and hyphens, starting with alphanumeric.`
    );
  }

  // Ensure default group exists and use it if no groupId specified
  let groupId = params.groupId;
  if (!groupId) {
    const { groupId: defaultGroupId } = await ensureProjectChannels(projectId);
    groupId = defaultGroupId;
  }

  const displayName = params.displayName || `#${name}`;

  const [channel] = await db
    .insert(channels)
    .values({
      projectId,
      groupId,
      name,
      displayName,
      type,
      topic,
      createdBySessionId,
    })
    .returning();

  log.info("Channel created", { channelId: channel.id, name, projectId });
  return channel;
}

/**
 * List all channel groups with nested channels for a project.
 * Includes unread counts for the given user.
 */
export async function listChannelGroups(
  projectId: string,
  userId: string
) {
  await ensureProjectChannels(projectId);

  const groups = await db.query.channelGroups.findMany({
    where: eq(channelGroups.projectId, projectId),
    orderBy: channelGroups.position,
  });

  const allChannels = await db.query.channels.findMany({
    where: and(
      eq(channels.projectId, projectId),
      isNull(channels.archivedAt)
    ),
    orderBy: channels.createdAt,
  });

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

  const readStateMap = new Map(
    readStates
      .filter((rs) => rs.lastReadAt !== null)
      .map((rs) => [rs.channelId, rs.lastReadAt as Date])
  );

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
    const unreadCount = lastReadAt
      ? (unreadCountMap.get(ch.id) ?? 0)
      : (neverReadCountMap.get(ch.id) ?? 0);

    return {
      id: ch.id,
      projectId: ch.projectId,
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
    projectId: g.projectId,
    name: g.name,
    position: g.position,
    channels: channelsWithUnread.filter((c) => c.groupId === g.id),
  }));
}

/**
 * Resolve the list of project ids that correspond to a project/group node.
 * For a project node, this is just `[id]`. For a group node, it is every
 * descendant project id.
 */
async function resolveProjectIdsForNode(node: {
  id: string;
  type: "group" | "project";
}): Promise<string[]> {
  if (node.type === "project") {
    const row = await db.query.projects.findFirst({
      where: eq(projects.id, node.id),
      columns: { id: true },
    });
    return row ? [row.id] : [];
  }
  const res = await client.execute({
    sql: `
      WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 0 FROM project_group WHERE id = ?
        UNION
        SELECT pg.id, d.depth + 1 FROM project_group pg
          JOIN descendants d ON pg.parent_group_id = d.id
          WHERE d.depth < 128
      )
      SELECT p.id AS project_id
      FROM project p
      WHERE p.group_id IN (SELECT id FROM descendants)
    `,
    args: [node.id],
  });
  return res.rows
    .map((r) => r.project_id as string | null)
    .filter((id): id is string => Boolean(id));
}

/**
 * List channel groups scoped to a project/group node. For group nodes, this
 * aggregates channels from every descendant project.
 */
export async function listChannelGroupsForNode(
  node: { id: string; type: "group" | "project" },
  userId: string
) {
  const projectIds = await resolveProjectIdsForNode(node);
  if (projectIds.length === 0) return [];

  if (projectIds.length === 1) {
    return listChannelGroups(projectIds[0], userId);
  }

  const perProject = await Promise.all(
    projectIds.map((pid) => listChannelGroups(pid, userId))
  );
  return perProject.flat();
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
 * Verify a channel belongs to a specific project.
 */
export async function verifyChannelInProject(
  channelId: string,
  projectId: string
): Promise<boolean> {
  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.id, channelId), eq(channels.projectId, projectId)),
    columns: { id: true },
  });
  return !!ch;
}

// ─── Access Checks (shared by API routes) ────────────────────────────────────

/**
 * Verify the user owns the project containing a channel.
 * Returns the projectId on success, or null if the channel doesn't exist
 * or the user doesn't own the project.
 */
export async function verifyChannelAccess(
  channelId: string,
  userId: string
): Promise<{ projectId: string } | null> {
  const channel = await getChannel(channelId);
  if (!channel) return null;

  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, channel.projectId),
      eq(projects.userId, userId)
    ),
    columns: { id: true },
  });
  if (!project) return null;

  return { projectId: channel.projectId };
}

/**
 * Verify the user owns the given project.
 */
export async function verifyProjectOwnership(
  projectId: string,
  userId: string
): Promise<boolean> {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.userId, userId)
    ),
    columns: { id: true },
  });
  return !!project;
}

/**
 * Find or create a DM channel between two sessions.
 * DM channel names are deterministic: `dm-{minId8}-{maxId8}` for idempotency.
 */
export async function findOrCreateDmChannel(
  projectId: string,
  sessionIdA: string,
  sessionIdB: string
) {
  const [minId, maxId] = [sessionIdA, sessionIdB].sort();
  const dmName = `dm-${minId.slice(0, 8)}-${maxId.slice(0, 8)}`;

  const existing = await db.query.channels.findFirst({
    where: and(eq(channels.projectId, projectId), eq(channels.name, dmName)),
  });
  if (existing) return existing;

  await db
    .insert(channelGroups)
    .values({ projectId, name: DM_GROUP_NAME, position: 100 })
    .onConflictDoNothing({ target: [channelGroups.projectId, channelGroups.name] });

  const dmGroup = await db.query.channelGroups.findFirst({
    where: and(
      eq(channelGroups.projectId, projectId),
      eq(channelGroups.name, DM_GROUP_NAME)
    ),
    columns: { id: true },
  });

  if (!dmGroup) throw new Error("Failed to create DM group");

  const [channel] = await db
    .insert(channels)
    .values({
      projectId,
      groupId: dmGroup.id,
      name: dmName,
      displayName: dmName,
      type: "dm",
    })
    .onConflictDoNothing({ target: [channels.projectId, channels.name] })
    .returning();

  if (!channel) {
    const raced = await db.query.channels.findFirst({
      where: and(eq(channels.projectId, projectId), eq(channels.name, dmName)),
    });
    if (!raced) throw new Error("Failed to create DM channel");
    return raced;
  }

  log.info("DM channel created", { channelId: channel.id, projectId });
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
