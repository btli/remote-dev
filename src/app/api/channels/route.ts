import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as ChannelService from "@/services/channel-service";
import { ChannelValidationError } from "@/services/channel-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/channels");

// GET /api/channels?projectId= — list channel groups with unread counts.
// Also accepts ?nodeId=&nodeType=(group|project) for node-scoped listing
// (group nodes aggregate across all descendant projects).
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const nodeId = searchParams.get("nodeId");
    const nodeType = searchParams.get("nodeType");

    if (nodeId && (nodeType === "group" || nodeType === "project")) {
      const groups = await ChannelService.listChannelGroupsForNode(
        { id: nodeId, type: nodeType },
        userId
      );
      return NextResponse.json({ groups });
    }

    if (!projectId) {
      return errorResponse("projectId or nodeId is required", 400);
    }

    if (!(await ChannelService.verifyProjectOwnership(projectId, userId))) {
      return errorResponse("Project not found", 404);
    }

    const groups = await ChannelService.listChannelGroups(projectId, userId);
    return NextResponse.json({ groups });
  } catch (err) {
    log.error("Failed to list channel groups", { error: String(err) });
    return errorResponse("Failed to list channels", 500);
  }
});

// POST /api/channels — create channel { projectId, name, topic? }
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{ projectId: string; name: string; topic?: string }>(request);
    if ("error" in result) return result.error;
    const { projectId, name, topic } = result.data;

    if (!projectId || !name) {
      return errorResponse("projectId and name are required", 400);
    }

    if (!(await ChannelService.verifyProjectOwnership(projectId, userId))) {
      return errorResponse("Project not found", 404);
    }

    const channel = await ChannelService.createChannel({ projectId, name, topic });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    if (err instanceof ChannelValidationError) {
      return errorResponse(err.message, 400);
    }
    log.error("Failed to create channel", { error: String(err) });
    return errorResponse("Failed to create channel", 500);
  }
});
