import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SessionService from "@/services/session-service";
import type { CreateSessionInput } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/sessions/spawn");

/**
 * POST /api/sessions/:id/spawn - Spawn a child session from a parent session
 *
 * Creates a new session linked to the parent via parentSessionId.
 * Inherits folder, working directory, and agent provider from parent unless overridden.
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    const parentId = params?.id;
    if (!parentId) {
      return errorResponse("Parent session ID is required", 400, "ID_REQUIRED");
    }

    const result = await parseJsonBody<{
      name?: string;
      terminalType?: "shell" | "agent" | "file" | "browser";
      agentProvider?: string;
      folderId?: string;
      projectId?: string;
      workingDirectory?: string;
      profileId?: string;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // Look up parent session and verify ownership
    const parent = await SessionService.getSession(parentId, userId);
    if (!parent) {
      return errorResponse("Parent session not found", 404, "SESSION_NOT_FOUND");
    }

    const name = body.name || `${parent.name}-child`;

    const input: CreateSessionInput = {
      name,
      terminalType: body.terminalType || parent.terminalType || "agent",
      agentProvider: (body.agentProvider || parent.agentProvider || "claude") as CreateSessionInput["agentProvider"],
      projectId: body.projectId ?? body.folderId ?? parent.projectId ?? undefined,
      projectPath: body.workingDirectory || parent.projectPath || undefined,
      profileId: body.profileId || parent.profileId || undefined,
      parentSessionId: parentId,
    };

    const session = await SessionService.createSession(userId, input);

    log.info("Spawned child session", {
      parentId,
      childId: session.id,
      name,
      provider: session.agentProvider,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    log.error("Error spawning child session", { error: String(error) });

    if (error instanceof SessionService.SessionServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to spawn child session", 500);
  }
});
