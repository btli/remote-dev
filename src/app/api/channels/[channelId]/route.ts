import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { ChannelArchiveError } from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/[channelId]");

// GET /api/channels/:channelId — get channel details
export const GET = withApiAuth(async (_request, context) => {
  try {
    const channelId = context.params!.channelId;

    if (!(await ChannelService.verifyChannelAccess(channelId, context.userId))) {
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
    const channelId = context.params!.channelId;

    if (!(await ChannelService.verifyChannelAccess(channelId, context.userId))) {
      return errorResponse("Channel not found", 404);
    }

    await ChannelService.archiveChannel(channelId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ChannelArchiveError) {
      return errorResponse(err.message, 400);
    }
    log.error("Failed to archive channel", { error: String(err) });
    return errorResponse("Failed to archive channel", 500);
  }
});
