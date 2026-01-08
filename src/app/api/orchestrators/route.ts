import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import * as MonitoringService from "@/services/monitoring-service";

/**
 * GET /api/orchestrators - List user's orchestrators
 *
 * Returns all orchestrators (master + sub-orchestrators) for the authenticated user.
 */
export const GET = withAuth(async (request, { userId }) => {
  try {
    const orchestrators = await OrchestratorService.listOrchestrators(userId);

    // Add monitoring status to each orchestrator
    const orchestratorsWithStatus = orchestrators.map((orc) => ({
      id: orc.id,
      sessionId: orc.sessionId,
      type: orc.type,
      status: orc.status,
      scopeType: orc.scopeType,
      scopeId: orc.scopeId,
      customInstructions: orc.customInstructions,
      monitoringInterval: orc.monitoringInterval,
      stallThreshold: orc.stallThreshold,
      autoIntervention: orc.autoIntervention,
      lastActivityAt: orc.lastActivityAt,
      createdAt: orc.createdAt,
      updatedAt: orc.updatedAt,
      isMonitoringActive: MonitoringService.isMonitoringActive(orc.id),
    }));

    return NextResponse.json({ orchestrators: orchestratorsWithStatus });
  } catch (error) {
    console.error("Error listing orchestrators:", error);
    return errorResponse("Failed to list orchestrators", 500);
  }
});

/**
 * POST /api/orchestrators - Create a new orchestrator
 *
 * Creates either a master orchestrator (monitors all sessions) or
 * a sub-orchestrator (monitors sessions in a specific folder).
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      sessionId: string;
      type: "master" | "sub_orchestrator";
      folderId?: string;
      customInstructions?: string;
      monitoringInterval?: number;
      stallThreshold?: number;
      autoIntervention?: boolean;
      startMonitoring?: boolean; // Whether to start monitoring immediately
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    // Validate type
    if (!body.type || !["master", "sub_orchestrator"].includes(body.type)) {
      return errorResponse(
        "Invalid orchestrator type. Must be 'master' or 'sub_orchestrator'",
        400,
        "INVALID_TYPE"
      );
    }

    // Validate sub-orchestrator requires folderId
    if (body.type === "sub_orchestrator" && !body.folderId) {
      return errorResponse(
        "Sub-orchestrator requires folderId",
        400,
        "MISSING_FOLDER_ID"
      );
    }

    // Create orchestrator based on type
    let orchestratorResult;
    if (body.type === "master") {
      orchestratorResult = await OrchestratorService.createMasterOrchestrator({
        userId,
        sessionId: body.sessionId,
        customInstructions: body.customInstructions,
        monitoringInterval: body.monitoringInterval,
        stallThreshold: body.stallThreshold,
        autoIntervention: body.autoIntervention,
      });
    } else {
      if (!body.folderId) {
        return errorResponse(
          "folderId is required for sub-orchestrator",
          400,
          "MISSING_FOLDER_ID"
        );
      }
      orchestratorResult = await OrchestratorService.createSubOrchestrator({
        userId,
        sessionId: body.sessionId,
        folderId: body.folderId,
        customInstructions: body.customInstructions,
        monitoringInterval: body.monitoringInterval,
        stallThreshold: body.stallThreshold,
        autoIntervention: body.autoIntervention,
      });
    }

    // Start monitoring if requested (default: true)
    if (body.startMonitoring !== false) {
      MonitoringService.startMonitoring(orchestratorResult.orchestrator.id, userId);
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
        auditLog: {
          id: orchestratorResult.auditLog.id,
          actionType: orchestratorResult.auditLog.actionType,
          timestamp: orchestratorResult.auditLog.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating orchestrator:", error);

    if (error instanceof OrchestratorService.OrchestratorServiceError) {
      return errorResponse(error.message, 400, error.code);
    }

    return errorResponse("Failed to create orchestrator", 500);
  }
});
