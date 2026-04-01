import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as ChannelService from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/[channelId]");

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

// GET /api/channels/:channelId — get channel details
export const GET = withApiAuth(async (_request, context) => {
  try {
    const { channelId } = await context.params;

    if (!(await verifyChannelAccess(channelId, context.userId))) {
      return errorResponse("Channel not found", 404);
    }

    const channel = await ChannelService.getChannel(channelId);
    return NextResponse.json({ channel });
  } catch (err) {
    log.error("Failed to get channel", { error: String(err) });
    return errorResponse("Failed to get channel", 500);
  }
});

// DELETE /api/channels/:channelId — archive channel
export const DELETE = withApiAuth(async (_request, context) => {
  try {
    const { channelId } = await context.params;

    if (!(await verifyChannelAccess(channelId, context.userId))) {
      return errorResponse("Channel not found", 404);
    }

    await ChannelService.archiveChannel(channelId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot archive the default channel")) {
      return errorResponse(msg, 400);
    }
    log.error("Failed to archive channel", { error: String(err) });
    return errorResponse("Failed to archive channel", 500);
  }
});
