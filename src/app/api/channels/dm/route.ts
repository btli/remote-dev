import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as ChannelService from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/dm");

/** Verify the user owns the given folder. */
async function verifyFolderOwnership(folderId: string, userId: string): Promise<boolean> {
  const folder = await db.query.sessionFolders.findFirst({
    where: and(
      eq(sessionFolders.id, folderId),
      eq(sessionFolders.userId, userId)
    ),
    columns: { id: true },
  });
  return !!folder;
}

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

    if (!(await verifyFolderOwnership(folderId, userId))) {
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
