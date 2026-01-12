import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";
import * as OrchestratorService from "@/services/orchestrator-service";

/**
 * GET /api/folders/:id/orchestrator - Get folder's sub-orchestrator
 *
 * Proxies to rdv-server for read operations.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/orchestrator`,
  });
});

/**
 * POST /api/folders/:id/orchestrator - Create or get folder sub-orchestrator
 *
 * Creates a folder orchestrator with full bootstrap:
 * - Creates Claude Code session for the folder
 * - Generates CLAUDE.md with folder-specific instructions and project knowledge
 * - Creates .mcp.json for MCP server access
 * - Starts Claude Code with --resume command
 *
 * If orchestrator already exists for this folder, returns it without creating a new one.
 * Includes IDOR protection - validates folder ownership.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  const folderId = params!.id;

  const result = await parseJsonBody<{
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }>(request);

  // Body is optional for this endpoint
  const body = "error" in result ? {} : result.data;

  try {
    const { orchestrator, created, sessionId } = await OrchestratorService.ensureFolderSubOrchestrator(
      userId,
      folderId,
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
  } catch (error) {
    const err = error as Error & { code?: string };

    // Handle specific error codes
    if (err.code === "FOLDER_NOT_FOUND") {
      return errorResponse("Folder not found or access denied", 404, "FOLDER_NOT_FOUND");
    }
    if (err.code === "NO_PROJECT_PATH") {
      return errorResponse(
        "Folder has no sessions with a project path. Create a session first.",
        400,
        "NO_PROJECT_PATH"
      );
    }

    return errorResponse(
      err.message || "Failed to create folder orchestrator",
      500,
      err.code || "ORCHESTRATOR_ERROR"
    );
  }
});

/**
 * DELETE /api/folders/:id/orchestrator - Delete folder's sub-orchestrator
 *
 * Deletes the folder orchestrator with proper ownership validation.
 * The service layer validates that the orchestrator belongs to the user
 * before deletion (IDOR protection).
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  const folderId = params!.id;

  try {
    // First get the orchestrator for this folder
    const orchestrator = await OrchestratorService.getSubOrchestratorForFolder(folderId, userId);

    if (!orchestrator) {
      return errorResponse("No orchestrator found for this folder", 404, "ORCHESTRATOR_NOT_FOUND");
    }

    // Delete using the service which validates ownership
    const deleted = await OrchestratorService.deleteOrchestrator(orchestrator.id, userId);

    if (deleted) {
      return NextResponse.json({ success: true });
    } else {
      return errorResponse("Failed to delete orchestrator", 500, "DELETE_FAILED");
    }
  } catch (error) {
    const err = error as Error & { code?: string };

    if (err.code === "ORCHESTRATOR_NOT_FOUND") {
      return errorResponse("Orchestrator not found", 404, "ORCHESTRATOR_NOT_FOUND");
    }

    return errorResponse(
      err.message || "Failed to delete folder orchestrator",
      500,
      err.code || "DELETE_ERROR"
    );
  }
});
