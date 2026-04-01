import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as ChannelService from "@/services/channel-service";
import * as PeerService from "@/services/peer-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/[channelId]/messages/[messageId]/thread");

/** Verify the user owns the folder that contains this channel. */
async function verifyChannelAccess(
  channelId: string,
  userId: string
): Promise<boolean> {
  const channel = await ChannelService.getChannel(channelId);
  if (!channel) return false;

  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, channel.folderId),
      eq(sessionFolders.userId, userId)
    ),
    columns: { id: true },
  });
  return !!folder;
}

// GET /api/channels/:channelId/messages/:messageId/thread?limit=100
export const GET = withApiAuth(async (request, context) => {
  try {
    const channelId = context.params!.channelId;
    const messageId = context.params!.messageId;

    if (!(await verifyChannelAccess(channelId, context.userId))) {
      return errorResponse("Channel not found", 404);
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "100", 10);
    const limit = Number.isNaN(rawLimit) ? 100 : Math.min(Math.max(1, rawLimit), 500);

    const replies = await PeerService.listThreadReplies(messageId, limit);
    return NextResponse.json({ replies });
  } catch (err) {
    log.error("Failed to list thread replies", { error: String(err) });
    return errorResponse("Failed to list thread replies", 500);
  }
});
