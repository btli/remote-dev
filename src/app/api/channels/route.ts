import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { ChannelValidationError } from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels");

// GET /api/channels?folderId= — list channel groups with unread counts
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");

    if (!folderId) {
      return errorResponse("folderId is required", 400);
    }

    if (!(await ChannelService.verifyFolderOwnership(folderId, userId))) {
      return errorResponse("Folder not found", 404);
    }

    const groups = await ChannelService.listChannelGroups(folderId, userId);
    return NextResponse.json({ groups });
  } catch (err) {
    log.error("Failed to list channel groups", { error: String(err) });
    return errorResponse("Failed to list channels", 500);
  }
});

// POST /api/channels — create channel { folderId, name, topic? }
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ folderId: string; name: string; topic?: string }>(request);
    if ("error" in result) return result.error;
    const { folderId, name, topic } = result.data;

    if (!folderId || !name) {
      return errorResponse("folderId and name are required", 400);
    }

    if (!(await ChannelService.verifyFolderOwnership(folderId, userId))) {
      return errorResponse("Folder not found", 404);
    }

    const channel = await ChannelService.createChannel({ folderId, name, topic });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    if (err instanceof ChannelValidationError) {
      return errorResponse(err.message, 400);
    }
    log.error("Failed to create channel", { error: String(err) });
    return errorResponse("Failed to create channel", 500);
  }
});
