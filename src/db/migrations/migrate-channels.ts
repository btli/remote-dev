/**
 * One-time migration: create default channels for existing folders with peer messages
 * and assign all existing messages to their folder's #general channel.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: bun run db:migrate-channels
 */

import { db } from "@/db";
import { agentPeerMessages, channels } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import * as ChannelService from "@/services/channel-service";

async function main() {
  console.log("Starting channel migration...");

  // Find all distinct folder IDs with peer messages
  const folders = await db
    .selectDistinct({ folderId: agentPeerMessages.folderId })
    .from(agentPeerMessages);

  console.log(`Found ${folders.length} folder(s) with peer messages`);

  let migrated = 0;
  for (const { folderId } of folders) {
    // Ensure default group + #general channel
    const { generalChannelId } = await ChannelService.ensureFolderChannels(folderId);

    // Assign all unassigned messages to #general
    await db
      .update(agentPeerMessages)
      .set({ channelId: generalChannelId })
      .where(
        sql`${agentPeerMessages.folderId} = ${folderId} AND ${agentPeerMessages.channelId} IS NULL`
      );

    // Update message count on the channel
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentPeerMessages)
      .where(eq(agentPeerMessages.channelId, generalChannelId));

    const count = countResult[0]?.count ?? 0;
    await db
      .update(channels)
      .set({ messageCount: count })
      .where(eq(channels.id, generalChannelId));

    // Backfill lastMessageAt
    const lastMsgResult = await db
      .select({ maxCreatedAt: sql<number>`max(${agentPeerMessages.createdAt})` })
      .from(agentPeerMessages)
      .where(eq(agentPeerMessages.channelId, generalChannelId));

    const maxCreatedAt = lastMsgResult[0]?.maxCreatedAt;
    if (maxCreatedAt) {
      await db
        .update(channels)
        .set({ lastMessageAt: new Date(maxCreatedAt) })
        .where(eq(channels.id, generalChannelId));
    }

    console.log(`  Folder ${folderId}: assigned messages to #general (${count} total)`);
    migrated++;
  }

  console.log(`Migration complete. Processed ${migrated} folder(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
