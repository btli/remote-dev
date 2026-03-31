import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { sessionFolders, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as PeerService from "@/services/peer-service";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/peers/messages");

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

// GET /api/peers/messages?folderId=<uuid>&limit=200
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");

    if (!folderId) {
      return errorResponse("folderId is required", 400);
    }

    if (!(await verifyFolderOwnership(folderId, userId))) {
      return errorResponse("Folder not found", 404);
    }

    const rawLimit = parseInt(searchParams.get("limit") ?? "200", 10);
    const limit = Number.isNaN(rawLimit) ? 200 : Math.min(Math.max(1, rawLimit), 500);

    const messages = await PeerService.listFolderMessages(folderId, limit);
    return NextResponse.json({ messages });
  } catch (err) {
    log.error("Failed to list peer messages", { error: String(err) });
    return errorResponse("Failed to list messages", 500);
  }
});

// POST /api/peers/messages — send a user message (broadcast to all agents)
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ folderId: string; body: string }>(request);
    if ("error" in result) return result.error;
    const { folderId, body } = result.data;

    if (!folderId || !body) {
      return errorResponse("folderId and body are required", 400);
    }

    if (!(await verifyFolderOwnership(folderId, userId))) {
      return errorResponse("Folder not found", 404);
    }

    // Look up user's display name
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    });
    const fromName = user?.name || user?.email || "User";

    const { messageId, message } = await PeerService.sendUserMessage({
      folderId,
      fromName,
      body,
    });

    // Broadcast to all WebSocket clients via terminal server
    try {
      const baseUrl = resolveTerminalServerUrl();
      await fetch(`${baseUrl}/internal/peers/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, message }),
      });
    } catch (err) {
      log.warn("Failed to broadcast peer message", { error: String(err) });
    }

    return NextResponse.json({ messageId, message });
  } catch (err) {
    log.error("Failed to send user message", { error: String(err) });
    return errorResponse("Failed to send message", 500);
  }
});
