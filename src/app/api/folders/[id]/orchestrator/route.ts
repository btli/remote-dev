import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import * as MonitoringService from "@/services/monitoring-service";

/**
 * GET /api/folders/:id/orchestrator - Get folder's sub-orchestrator
 *
 * Returns the sub-orchestrator for this folder if it exists.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    const orchestrator = await OrchestratorService.getSubOrchestratorForFolder(
      folderId,
      userId
    );

    if (!orchestrator) {
      return NextResponse.json({ orchestrator: null });
    }

    return NextResponse.json({
      orchestrator: {
        id: orchestrator.id,
        sessionId: orchestrator.sessionId,
        type: orchestrator.type,
        status: orchestrator.status,
        scopeType: orchestrator.scopeType,
        scopeId: orchestrator.scopeId,
        customInstructions: orchestrator.customInstructions,
        monitoringInterval: orchestrator.monitoringInterval,
        stallThreshold: orchestrator.stallThreshold,
        autoIntervention: orchestrator.autoIntervention,
        lastActivityAt: orchestrator.lastActivityAt,
        createdAt: orchestrator.createdAt,
        updatedAt: orchestrator.updatedAt,
        isMonitoringActive: MonitoringService.isMonitoringActive(orchestrator.id),
      },
    });
  } catch (error) {
    console.error("Error getting folder orchestrator:", error);
    return errorResponse("Failed to get folder orchestrator", 500);
  }
});

/**
 * POST /api/folders/:id/orchestrator - Create or get folder sub-orchestrator
 *
 * Creates a sub-orchestrator for this folder with automatic session setup.
 * If one already exists, returns the existing orchestrator.
 */
export const POST = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    const result = await parseJsonBody<{
      customInstructions?: string;
      monitoringInterval?: number;
      stallThreshold?: number;
      autoIntervention?: boolean;
      startMonitoring?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    const orchestratorResult = await OrchestratorService.ensureFolderSubOrchestrator(
      userId,
      folderId,
      {
        customInstructions: body.customInstructions,
        monitoringInterval: body.monitoringInterval,
        stallThreshold: body.stallThreshold,
        autoIntervention: body.autoIntervention,
      }
    );

    // Start monitoring if orchestrator was just created (default: true)
    if (orchestratorResult.created && body.startMonitoring !== false) {
      MonitoringService.startMonitoring(orchestratorResult.orchestrator.id, userId);
      console.log(
        `[API] Created and started sub-orchestrator for folder ${folderId}`
      );
    }

    return NextResponse.json(
      {
        orchestrator: {
          id: orchestratorResult.orchestrator.id,
          sessionId: orchestratorResult.orchestrator.sessionId,
          type: orchestratorResult.orchestrator.type,
          status: orchestratorResult.orchestrator.status,
          scopeType: orchestratorResult.orchestrator.scopeType,
          scopeId: orchestratorResult.orchestrator.scopeId,
          customInstructions: orchestratorResult.orchestrator.customInstructions,
          monitoringInterval: orchestratorResult.orchestrator.monitoringInterval,
          stallThreshold: orchestratorResult.orchestrator.stallThreshold,
          autoIntervention: orchestratorResult.orchestrator.autoIntervention,
          lastActivityAt: orchestratorResult.orchestrator.lastActivityAt,
          createdAt: orchestratorResult.orchestrator.createdAt,
          updatedAt: orchestratorResult.orchestrator.updatedAt,
        },
        created: orchestratorResult.created,
        sessionId: orchestratorResult.sessionId,
      },
      { status: orchestratorResult.created ? 201 : 200 }
    );
  } catch (error) {
    console.error("Error creating folder orchestrator:", error);

    if (error instanceof OrchestratorService.OrchestratorServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to create folder orchestrator", 500);
  }
});

/**
 * DELETE /api/folders/:id/orchestrator - Delete folder's sub-orchestrator
 *
 * Stops monitoring and deletes the sub-orchestrator for this folder.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    // Get the orchestrator to delete
    const orchestrator = await OrchestratorService.getSubOrchestratorForFolder(
      folderId,
      userId
    );

    if (!orchestrator) {
      return errorResponse("Folder orchestrator not found", 404, "NOT_FOUND");
    }

    // Stop monitoring
    MonitoringService.stopMonitoring(orchestrator.id);

    // Delete orchestrator
    const deleted = await OrchestratorService.deleteOrchestrator(
      orchestrator.id,
      userId
    );

    if (!deleted) {
      return errorResponse("Failed to delete orchestrator", 500);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder orchestrator:", error);

    if (error instanceof OrchestratorService.OrchestratorServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to delete folder orchestrator", 500);
  }
});
