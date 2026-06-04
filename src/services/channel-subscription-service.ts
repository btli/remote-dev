/**
 * ChannelSubscriptionService — explicit per-agent channel subscriptions.
 *
 * [x386.5] Channel messages used to push to ALL project peers, which floods
 * agents. A subscription model fixes that: an agent only auto-receives a
 * channel's broadcasts if it has an `auto_deliver` subscription (or the channel
 * is the default `#general`, which is auto-subscribe for everyone unless an
 * explicit `direct_only` row opts out). Without a row, an agent still gets
 * direct @mentions and replies-to-it in that channel (handled at send time).
 */

import { db } from "@/db";
import { channelSubscription, channels } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("ChannelSubscription");

export type SubscriptionMode = "auto_deliver" | "direct_only";

const GENERAL_CHANNEL_NAME = "general";

/** Subscribe (or update the mode of) a session to a channel. Idempotent. */
export async function subscribe(
  channelId: string,
  sessionId: string,
  mode: SubscriptionMode = "auto_deliver",
): Promise<void> {
  await db
    .insert(channelSubscription)
    .values({ channelId, sessionId, mode })
    .onConflictDoUpdate({
      target: [channelSubscription.channelId, channelSubscription.sessionId],
      set: { mode },
    });
  log.debug("Channel subscription upserted", { channelId, sessionId, mode });
}

/** Remove a session's subscription to a channel. */
export async function unsubscribe(channelId: string, sessionId: string): Promise<void> {
  await db
    .delete(channelSubscription)
    .where(
      and(
        eq(channelSubscription.channelId, channelId),
        eq(channelSubscription.sessionId, sessionId),
      ),
    );
}

/** All subscription rows for a channel (used by delivery fan-out + tests). */
export async function getSubscriptions(
  channelId: string,
): Promise<{ sessionId: string; mode: SubscriptionMode }[]> {
  const rows = await db.query.channelSubscription.findMany({
    where: eq(channelSubscription.channelId, channelId),
    columns: { sessionId: true, mode: true },
  });
  return rows.map((r) => ({ sessionId: r.sessionId, mode: r.mode as SubscriptionMode }));
}

/**
 * Resolve which of `projectPeers` should AUTO-RECEIVE a channel's non-direct
 * messages. Rules:
 *   - `#general` is the default channel: every peer auto-receives UNLESS it has
 *     an explicit `direct_only` row.
 *   - any other channel: a peer auto-receives only with an explicit
 *     `auto_deliver` row.
 *
 * `projectPeers` is the candidate set (active agent sessions in the project);
 * the returned list is always a subset of it. @mentioned sessions are added by
 * the caller (x386.7) regardless of subscription.
 */
export async function getAutoDeliverSessions(
  channelId: string,
  projectPeers: string[],
): Promise<string[]> {
  const subs = await getSubscriptions(channelId);
  const modeBySession = new Map(subs.map((s) => [s.sessionId, s.mode]));

  // Is this the project's default #general channel?
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
    columns: { isDefault: true, name: true },
  });
  const isGeneral = !!channel && (channel.isDefault || channel.name === GENERAL_CHANNEL_NAME);

  if (isGeneral) {
    // Everyone except explicit direct_only opt-outs.
    return projectPeers.filter((sid) => modeBySession.get(sid) !== "direct_only");
  }
  // Opt-in only.
  return projectPeers.filter((sid) => modeBySession.get(sid) === "auto_deliver");
}
