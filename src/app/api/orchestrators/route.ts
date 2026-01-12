import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import * as OrchestratorService from "@/services/orchestrator-service";

/**
 * GET /api/orchestrators - List user's orchestrators
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/orchestrators",
  });
});

/**
 * POST /api/orchestrators - Create a new orchestrator
 *
 * Creates an orchestrator with full bootstrap:
 * - Creates Claude Code session with proper naming
 * - Generates CLAUDE.md with orchestrator instructions
 * - Creates .mcp.json for MCP server access
 * - Starts Claude Code with --resume command
 *
 * For master orchestrator (type=master), uses ensureMasterOrchestrator.
 * For folder orchestrator (type=sub_orchestrator), uses ensureFolderSubOrchestrator.
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    type?: "master" | "sub_orchestrator";
    folderId?: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }>(request);

  if ("error" in result) return result.error;
  const body = result.data;

  try {
    if (body.type === "sub_orchestrator") {
      // Folder sub-orchestrator
      if (!body.folderId) {
        return errorResponse("folderId is required for sub_orchestrator type", 400, "MISSING_FOLDER_ID");
      }

      const { orchestrator, created, sessionId } = await OrchestratorService.ensureFolderSubOrchestrator(
        userId,
        body.folderId,
        {
          customInstructions: body.customInstructions,
          monitoringInterval: body.monitoringInterval,
          stallThreshold: body.stallThreshold,
          autoIntervention: body.autoIntervention,
        }
      );

      return NextResponse.json({
        orchestrator,
        created,
        sessionId,
      }, { status: created ? 201 : 200 });
    } else {
      // Default to master orchestrator
      const { orchestrator, created, sessionId } = await OrchestratorService.ensureMasterOrchestrator(userId);

      return NextResponse.json({
        orchestrator,
        created,
        sessionId,
      }, { status: created ? 201 : 200 });
    }
  } catch (error) {
    const err = error as Error & { code?: string };
    return errorResponse(
      err.message || "Failed to create orchestrator",
      500,
      err.code || "ORCHESTRATOR_ERROR"
    );
  }
});
