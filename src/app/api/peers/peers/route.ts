import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { db } from "@/db";
import { projects } from "@/db/schema";
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

    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, folderId),
        eq(projects.userId, userId)
      ),
      columns: { id: true },
    });

    if (!project) {
      return errorResponse("Folder not found", 404);
    }

    const peers = await PeerService.getProjectPeers(folderId);
    return NextResponse.json({ peers });
  } catch (err) {
    log.error("Failed to list folder peers", { error: String(err) });
    return errorResponse("Failed to list peers", 500);
  }
});
