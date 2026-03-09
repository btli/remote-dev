import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import type { AgentProviderType } from "@/types/session";

/**
 * GET /api/sessions/:id/children - List child sessions for an orchestrator
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);
    const children = await OrchestratorService.getChildSessions(
      userId,
      params.id
    );
    return NextResponse.json({ children });
  } catch (error) {
    console.error("Error listing child sessions:", error);
    return errorResponse("Failed to list children", 500);
  }
});

/**
 * POST /api/sessions/:id/children - Spawn a child session under an orchestrator
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    if (!params?.id) return errorResponse("Session ID required", 400);
    const result = await parseJsonBody<{
      folderId?: string;
      agentProvider?: string;
      name?: string;
      projectPath?: string;
    }>(request);
    if ("error" in result) return result.error;

    const child = await OrchestratorService.spawnChildSession(
      userId,
      params.id,
      {
        ...result.data,
        agentProvider: result.data.agentProvider as AgentProviderType | undefined,
      }
    );
    return NextResponse.json({ session: child }, { status: 201 });
  } catch (error) {
    if (error instanceof OrchestratorService.OrchestratorError) {
      return errorResponse(error.message, 400, error.code);
    }
    console.error("Error spawning child session:", error);
    return errorResponse("Failed to spawn child", 500);
  }
});
