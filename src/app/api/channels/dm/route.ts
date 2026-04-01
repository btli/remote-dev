import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/dm");

// POST /api/channels/dm — find/create DM { folderId, targetSessionId, fromSessionId }
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      folderId: string;
      targetSessionId: string;
      fromSessionId: string;
    }>(request);
    if ("error" in result) return result.error;
    const { folderId, targetSessionId, fromSessionId } = result.data;

    if (!folderId || !targetSessionId || !fromSessionId) {
      return errorResponse("folderId, targetSessionId, and fromSessionId are required", 400);
    }

    if (!(await ChannelService.verifyFolderOwnership(folderId, userId))) {
      return errorResponse("Folder not found", 404);
    }

    const channel = await ChannelService.findOrCreateDmChannel(
      folderId,
      fromSessionId,
      targetSessionId
    );
    return NextResponse.json({ channel });
  } catch (err) {
    log.error("Failed to find/create DM channel", { error: String(err) });
    return errorResponse("Failed to find or create DM channel", 500);
  }
});
