import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as PeerService from "@/services/peer-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/peers/peers");

// GET /api/peers/peers?folderId=<uuid>
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");

    if (!folderId) {
      return errorResponse("folderId is required", 400);
    }

    const folder = await db.query.sessionFolders.findFirst({
      where: and(
        eq(sessionFolders.id, folderId),
        eq(sessionFolders.userId, userId)
      ),
      columns: { id: true },
    });

    if (!folder) {
      return errorResponse("Folder not found", 404);
    }

    const peers = await PeerService.getFolderPeers(folderId);
    return NextResponse.json({ peers });
  } catch (err) {
    log.error("Failed to list folder peers", { error: String(err) });
    return errorResponse("Failed to list peers", 500);
  }
});
