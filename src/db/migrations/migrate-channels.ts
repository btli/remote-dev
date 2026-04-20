/**
 * One-time migration: create default channels for existing projects with peer
 * messages and assign all existing messages to their project's #general channel.
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

  // Find all distinct project IDs with peer messages
  const projectsWithMessages = await db
    .selectDistinct({ projectId: agentPeerMessages.projectId })
    .from(agentPeerMessages);

  console.log(`Found ${projectsWithMessages.length} project(s) with peer messages`);

  let migrated = 0;
  for (const { projectId } of projectsWithMessages) {
    // Ensure default group + #general channel
    const { generalChannelId } = await ChannelService.ensureProjectChannels(projectId);

    // Assign all unassigned messages to #general
    await db
      .update(agentPeerMessages)
      .set({ channelId: generalChannelId })
      .where(
        sql`${agentPeerMessages.projectId} = ${projectId} AND ${agentPeerMessages.channelId} IS NULL`
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

    console.log(`  Project ${projectId}: assigned messages to #general (${count} total)`);
    migrated++;
  }

  console.log(`Migration complete. Processed ${migrated} project(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
