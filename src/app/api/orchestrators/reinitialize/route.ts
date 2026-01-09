import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";

/**
 * POST /api/orchestrators/reinitialize - Reinitialize an orchestrator
 *
 * Reinitializes the master orchestrator or a folder orchestrator.
 * This will:
 * 1. Stop any active monitoring
 * 2. Delete the existing orchestrator (if any)
 * 3. Close the existing orchestrator session
 * 4. Create a new orchestrator with a new session
 *
 * Use this when an orchestrator is in a bad state or needs to be reset.
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      type: "master" | "folder";
      folderId?: string;
      config?: {
        customInstructions?: string;
        monitoringInterval?: number;
        stallThreshold?: number;
        autoIntervention?: boolean;
      };
    }>(request);

    if ("error" in result) return result.error;
    const { type, folderId, config } = result.data;

    if (!type || !["master", "folder"].includes(type)) {
      return errorResponse(
        "type is required and must be 'master' or 'folder'",
        400,
        "INVALID_TYPE"
      );
    }

    if (type === "folder" && !folderId) {
      return errorResponse(
        "folderId is required for folder orchestrator reinitialization",
        400,
        "MISSING_FOLDER_ID"
      );
    }

    if (type === "master") {
      const reinitResult = await OrchestratorService.reinitializeMasterOrchestrator(userId);

      return NextResponse.json({
        success: true,
        type: "master",
        orchestrator: {
          id: reinitResult.orchestrator.id,
          sessionId: reinitResult.sessionId,
          type: reinitResult.orchestrator.type,
          status: reinitResult.orchestrator.status,
        },
        previousOrchestrator: reinitResult.previousOrchestrator || null,
        message: reinitResult.previousOrchestrator
          ? "Master orchestrator reinitialized successfully"
          : "Master orchestrator created (no previous orchestrator existed)",
      });
    } else {
      const reinitResult = await OrchestratorService.reinitializeFolderOrchestrator(
        userId,
        folderId!,
        config
      );

      return NextResponse.json({
        success: true,
        type: "folder",
        folderId,
        orchestrator: {
          id: reinitResult.orchestrator.id,
          sessionId: reinitResult.sessionId,
          type: reinitResult.orchestrator.type,
          status: reinitResult.orchestrator.status,
          scopeId: reinitResult.orchestrator.scopeId,
        },
        previousOrchestrator: reinitResult.previousOrchestrator || null,
        message: reinitResult.previousOrchestrator
          ? "Folder orchestrator reinitialized successfully"
          : "Folder orchestrator created (no previous orchestrator existed)",
      });
    }
  } catch (error) {
    console.error("[API] Failed to reinitialize orchestrator:", error);

    if (error instanceof OrchestratorService.OrchestratorServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse(
      "Failed to reinitialize orchestrator",
      500,
      "REINIT_FAILED"
    );
  }
});
