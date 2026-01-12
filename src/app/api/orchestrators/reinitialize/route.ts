import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";

/**
 * POST /api/orchestrators/reinitialize - Reinitialize an orchestrator
 *
 * Reinitializes an orchestrator by:
 * 1. Stopping any active monitoring
 * 2. Deleting the existing orchestrator record
 * 3. Closing the existing orchestrator session
 * 4. Creating a new orchestrator with a new session
 *
 * Supports both master and folder orchestrators via type parameter.
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    type?: "master" | "folder";
    folderId?: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }>(request);

  if ("error" in result) return result.error;
  const body = result.data;

  try {
    if (body.type === "folder") {
      // Reinitialize folder orchestrator
      if (!body.folderId) {
        return errorResponse("folderId is required for folder type", 400, "MISSING_FOLDER_ID");
      }

      const { orchestrator, sessionId, previousOrchestrator } =
        await OrchestratorService.reinitializeFolderOrchestrator(
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
        sessionId,
        previousOrchestrator,
      });
    } else {
      // Default to master orchestrator reinit
      const { orchestrator, sessionId, previousOrchestrator } =
        await OrchestratorService.reinitializeMasterOrchestrator(userId);

      return NextResponse.json({
        orchestrator,
        sessionId,
        previousOrchestrator,
      });
    }
  } catch (error) {
    const err = error as Error & { code?: string };
    return errorResponse(
      err.message || "Failed to reinitialize orchestrator",
      500,
      err.code || "REINIT_ERROR"
    );
  }
});
