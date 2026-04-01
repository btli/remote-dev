import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/[channelId]/read");

// POST /api/channels/:channelId/read — mark channel read { messageId }
export const POST = withApiAuth(async (request, context) => {
  try {
    const channelId = context.params!.channelId;

    if (!(await ChannelService.verifyChannelAccess(channelId, context.userId))) {
      return errorResponse("Channel not found", 404);
    }

    const result = await parseJsonBody<{ messageId: string }>(request);
    if ("error" in result) return result.error;
    const { messageId } = result.data;

    if (!messageId) {
      return errorResponse("messageId is required", 400);
    }

    await ChannelService.markChannelRead(channelId, context.userId, messageId);
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Failed to mark channel read", { error: String(err) });
    return errorResponse("Failed to mark channel read", 500);
  }
});
