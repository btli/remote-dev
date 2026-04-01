import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as ChannelService from "@/services/channel-service";
import * as PeerService from "@/services/peer-service";
import { resolveTerminalServerUrl } from "@/lib/terminal-server-url";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/[channelId]/messages");

// GET /api/channels/:channelId/messages?before=&limit=
export const GET = withApiAuth(async (request, context) => {
  try {
    const channelId = context.params!.channelId;

    const access = await ChannelService.verifyChannelAccess(channelId, context.userId);
    if (!access) {
      return errorResponse("Channel not found", 404);
    }

    const { searchParams } = new URL(request.url);
    const beforeParam = searchParams.get("before");
    const limitParam = searchParams.get("limit");

    const before = beforeParam ? new Date(beforeParam) : undefined;
    if (before && isNaN(before.getTime())) {
      return errorResponse("Invalid before date parameter", 400);
    }
    const rawLimit = parseInt(limitParam ?? "50", 10);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(1, rawLimit), 200);

    const messages = await PeerService.listChannelMessages(channelId, { before, limit });
    return NextResponse.json({ messages });
  } catch (err) {
    log.error("Failed to list channel messages", { error: String(err) });
    return errorResponse("Failed to list messages", 500);
  }
});

// POST /api/channels/:channelId/messages — send message { body, parentMessageId? }
export const POST = withApiAuth(async (request, context) => {
  try {
    const channelId = context.params!.channelId;

    const access = await ChannelService.verifyChannelAccess(channelId, context.userId);
    if (!access) {
      return errorResponse("Channel not found", 404);
    }

    const result = await parseJsonBody<{ body: string; parentMessageId?: string }>(request);
    if ("error" in result) return result.error;
    const { body, parentMessageId } = result.data;

    if (!body) {
      return errorResponse("body is required", 400);
    }
    if (body.length > 8192) return errorResponse("Message body exceeds maximum length of 8192 characters", 400);

    // Validate parentMessageId belongs to this channel
    if (parentMessageId) {
      const { agentPeerMessages } = await import("@/db/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");
      const parent = await db.query.agentPeerMessages.findFirst({
        where: andOp(
          eqOp(agentPeerMessages.id, parentMessageId),
          eqOp(agentPeerMessages.channelId, channelId)
        ),
        columns: { id: true },
      });
      if (!parent) return errorResponse("Parent message not found in this channel", 400);
    }

    // Look up user's display name
    const user = await db.query.users.findFirst({
      where: eq(users.id, context.userId),
      columns: { name: true, email: true },
    });
    const fromName = user?.name || user?.email || "User";

    const { messageId, message } = await PeerService.sendUserMessage({
      folderId: access.folderId,
      fromName,
      body,
      channelId,
      parentMessageId,
    });

    // Broadcast to folder owner's WebSocket clients via terminal server
    try {
      const baseUrl = resolveTerminalServerUrl();
      const eventType = parentMessageId ? "thread_reply_created" : "channel_message_created";
      await fetch(`${baseUrl}/internal/peers/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: context.userId,
          folderId: access.folderId,
          channelId,
          parentMessageId: parentMessageId ?? null,
          message,
          type: eventType,
        }),
      });
    } catch (err) {
      log.warn("Failed to broadcast channel message", { error: String(err) });
    }

    return NextResponse.json({ messageId, message }, { status: 201 });
  } catch (err) {
    log.error("Failed to send channel message", { error: String(err) });
    return errorResponse("Failed to send message", 500);
  }
});
