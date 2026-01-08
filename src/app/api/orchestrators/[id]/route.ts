import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import * as MonitoringService from "@/services/monitoring-service";

/**
 * GET /api/orchestrators/[id] - Get orchestrator details
 */
export const GET = withAuth(async (request, { userId, params }) => {
    try {
      const orchestrator = await OrchestratorService.getOrchestrator(
        params!.id,
        userId
      );

      if (!orchestrator) {
        return errorResponse("Orchestrator not found", 404, "ORCHESTRATOR_NOT_FOUND");
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
          isMonitoringActive: MonitoringService.isMonitoringActive(params!.id),
        },
      });
    } catch (error) {
      console.error("Error getting orchestrator:", error);
      return errorResponse("Failed to get orchestrator", 500);
    }
  }
);

/**
 * PATCH /api/orchestrators/[id] - Update orchestrator
 *
 * Can update configuration or pause/resume the orchestrator.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
    try {
      const result = await parseJsonBody<{
        action?: "pause" | "resume";
        customInstructions?: string;
        monitoringInterval?: number;
        stallThreshold?: number;
        autoIntervention?: boolean;
      }>(request);
      if ("error" in result) return result.error;
      const body = result.data;

      // Handle pause/resume actions
      if (body.action === "pause") {
        const orchestratorResult = await OrchestratorService.pauseOrchestrator(
          params!.id,
          userId
        );

        // Stop monitoring
        MonitoringService.stopMonitoring(params!.id);

        return NextResponse.json({
          orchestrator: {
            id: orchestratorResult.orchestrator.id,
            status: orchestratorResult.orchestrator.status,
          },
          auditLog: {
            id: orchestratorResult.auditLog.id,
            actionType: orchestratorResult.auditLog.actionType,
          },
        });
      }

      if (body.action === "resume") {
        const orchestratorResult = await OrchestratorService.resumeOrchestrator(
          params!.id,
          userId
        );

        // Start monitoring
        MonitoringService.startMonitoring(params!.id, userId);

        return NextResponse.json({
          orchestrator: {
            id: orchestratorResult.orchestrator.id,
            status: orchestratorResult.orchestrator.status,
          },
          auditLog: {
            id: orchestratorResult.auditLog.id,
            actionType: orchestratorResult.auditLog.actionType,
          },
        });
      }

      // Handle configuration updates
      const updates: {
        customInstructions?: string;
        monitoringInterval?: number;
        stallThreshold?: number;
        autoIntervention?: boolean;
      } = {};

      if (body.customInstructions !== undefined) {
        updates.customInstructions = body.customInstructions;
      }
      if (body.monitoringInterval !== undefined) {
        updates.monitoringInterval = body.monitoringInterval;
      }
      if (body.stallThreshold !== undefined) {
        updates.stallThreshold = body.stallThreshold;
      }
      if (body.autoIntervention !== undefined) {
        updates.autoIntervention = body.autoIntervention;
      }

      // Only update if there are changes
      if (Object.keys(updates).length === 0) {
        return errorResponse(
          "No valid update fields provided",
          400,
          "NO_UPDATES"
        );
      }

      const updatedOrchestrator = await OrchestratorService.updateOrchestrator(
        params!.id,
        userId,
        updates
      );

      // If monitoring interval changed and monitoring is active, restart monitoring
      if (updates.monitoringInterval && MonitoringService.isMonitoringActive(params!.id)) {
        MonitoringService.stopMonitoring(params!.id);
        MonitoringService.startMonitoring(params!.id, userId);
      }

      return NextResponse.json({
        orchestrator: {
          id: updatedOrchestrator.id,
          sessionId: updatedOrchestrator.sessionId,
          type: updatedOrchestrator.type,
          status: updatedOrchestrator.status,
          scopeType: updatedOrchestrator.scopeType,
          scopeId: updatedOrchestrator.scopeId,
          customInstructions: updatedOrchestrator.customInstructions,
          monitoringInterval: updatedOrchestrator.monitoringInterval,
          stallThreshold: updatedOrchestrator.stallThreshold,
          autoIntervention: updatedOrchestrator.autoIntervention,
          lastActivityAt: updatedOrchestrator.lastActivityAt,
          createdAt: updatedOrchestrator.createdAt,
          updatedAt: updatedOrchestrator.updatedAt,
        },
      });
    } catch (error) {
      console.error("Error updating orchestrator:", error);

      if (error instanceof OrchestratorService.OrchestratorServiceError) {
        return errorResponse(error.message, 400, error.code);
      }

      return errorResponse("Failed to update orchestrator", 500);
    }
});

/**
 * DELETE /api/orchestrators/[id] - Delete orchestrator
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
    try {
      // Stop monitoring first
      MonitoringService.stopMonitoring(params!.id);

      // Delete orchestrator
      const deleted = await OrchestratorService.deleteOrchestrator(
        params!.id,
        userId
      );

      if (!deleted) {
        return errorResponse("Orchestrator not found", 404, "ORCHESTRATOR_NOT_FOUND");
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting orchestrator:", error);

      if (error instanceof OrchestratorService.OrchestratorServiceError) {
        return errorResponse(error.message, 400, error.code);
      }

      return errorResponse("Failed to delete orchestrator", 500);
    }
});
