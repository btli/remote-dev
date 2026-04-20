import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels/dm");

// POST /api/channels/dm — find/create DM { projectId, targetSessionId, fromSessionId }
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      projectId: string;
      targetSessionId: string;
      fromSessionId: string;
    }>(request);
    if ("error" in result) return result.error;
    const { projectId, targetSessionId, fromSessionId } = result.data;

    if (!projectId || !targetSessionId || !fromSessionId) {
      return errorResponse("projectId, targetSessionId, and fromSessionId are required", 400);
    }

    if (!(await ChannelService.verifyProjectOwnership(projectId, userId))) {
      return errorResponse("Project not found", 404);
    }

    // Verify fromSessionId belongs to this user
    const fromSession = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, fromSessionId),
        eq(terminalSessions.userId, userId)
      ),
      columns: { id: true },
    });
    if (!fromSession) return errorResponse("fromSessionId not found or not owned by user", 403);

    // Verify targetSessionId exists in the same project
    const targetSession = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, targetSessionId),
        eq(terminalSessions.projectId, projectId)
      ),
      columns: { id: true },
    });
    if (!targetSession) return errorResponse("Target session not found in this project", 404);

    const channel = await ChannelService.findOrCreateDmChannel(
      projectId,
      fromSessionId,
      targetSessionId
    );
    return NextResponse.json({ channel });
  } catch (err) {
    log.error("Failed to find/create DM channel", { error: String(err) });
    return errorResponse("Failed to find or create DM channel", 500);
  }
});
