import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import * as InsightService from "@/services/insight-service";
import type { InsightType, InsightSeverity } from "@/types/orchestrator";

/**
 * GET /api/orchestrators/[id]/insights - List insights for orchestrator
 *
 * Query parameters:
 * - sessionId: Filter by session ID
 * - type: Filter by insight type
 * - severity: Filter by severity
 * - resolved: Filter by resolved status (true/false)
 * - limit: Max results (default: 50)
 */
export const GET = withAuth(async (request, { userId, params }) => {
    try {
      // Verify orchestrator exists and belongs to user
      const orchestrator = await OrchestratorService.getOrchestrator(
        params!.id,
        userId
      );

      if (!orchestrator) {
        return errorResponse("Orchestrator not found", 404, "ORCHESTRATOR_NOT_FOUND");
      }

      // Parse query parameters
      const { searchParams } = new URL(request.url);
      const sessionId = searchParams.get("sessionId");
      const type = searchParams.get("type") as InsightType | null;
      const severity = searchParams.get("severity") as InsightSeverity | null;
      const resolvedParam = searchParams.get("resolved");
      const limitParam = searchParams.get("limit");

      // Build filters
      const filters: Parameters<typeof InsightService.listInsights>[0] = {
        orchestratorId: params!.id,
      };

      if (sessionId) {
        filters.sessionId = sessionId;
      }

      if (type) {
        filters.type = type;
      }

      if (severity) {
        filters.severity = severity;
      }

      if (resolvedParam !== null) {
        filters.resolved = resolvedParam === "true";
      }

      const limit = limitParam ? parseInt(limitParam, 10) : 50;

      // Get insights
      const insights = await InsightService.listInsights(filters, limit);

      // Get insight counts
      const counts = await InsightService.getInsightCounts(params!.id);

      return NextResponse.json({
        orchestratorId: params!.id,
        count: insights.length,
        counts,
        insights: insights.map((insight) => ({
          id: insight.id,
          orchestratorId: insight.orchestratorId,
          sessionId: insight.sessionId,
          type: insight.type,
          severity: insight.severity,
          message: insight.message,
          context: insight.context,
          suggestedActions: insight.suggestedActions,
          resolved: insight.resolved,
          resolvedAt: insight.resolvedAt,
          createdAt: insight.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error listing insights:", error);
      return errorResponse("Failed to list insights", 500);
    }
});
