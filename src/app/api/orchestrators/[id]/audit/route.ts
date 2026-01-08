import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as OrchestratorService from "@/services/orchestrator-service";
import { db } from "@/db";
import { orchestratorAuditLog } from "@/db/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import type { AuditLogActionType } from "@/types/orchestrator";

/**
 * GET /api/orchestrators/[id]/audit - Get audit logs for orchestrator
 *
 * Query parameters:
 * - actionType: Filter by action type
 * - sessionId: Filter by target session ID
 * - startDate: Filter by start date (ISO 8601)
 * - endDate: Filter by end date (ISO 8601)
 * - limit: Max results (default: 100)
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
      const actionType = searchParams.get("actionType") as AuditLogActionType | null;
      const sessionId = searchParams.get("sessionId");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const limitParam = searchParams.get("limit");

      // Build query
      const conditions = [eq(orchestratorAuditLog.orchestratorId, params!.id)];

      if (actionType) {
        conditions.push(eq(orchestratorAuditLog.actionType, actionType));
      }

      if (sessionId) {
        conditions.push(eq(orchestratorAuditLog.targetSessionId, sessionId));
      }

      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          conditions.push(gte(orchestratorAuditLog.createdAt, start));
        }
      }

      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          conditions.push(lte(orchestratorAuditLog.createdAt, end));
        }
      }

      const limit = limitParam ? parseInt(limitParam, 10) : 100;

      // Execute query
      const logs = await db
        .select()
        .from(orchestratorAuditLog)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(desc(orchestratorAuditLog.createdAt))
        .limit(Math.min(limit, 500)); // Cap at 500 to prevent abuse

      // Get total count for pagination
      const totalResult = await db
        .select()
        .from(orchestratorAuditLog)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

      return NextResponse.json({
        orchestratorId: params!.id,
        count: logs.length,
        total: totalResult.length,
        logs: logs.map((log) => ({
          id: log.id,
          orchestratorId: log.orchestratorId,
          actionType: log.actionType,
          targetSessionId: log.targetSessionId,
          details: log.detailsJson ? JSON.parse(log.detailsJson) : null,
          createdAt: log.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error getting audit logs:", error);
      return errorResponse("Failed to get audit logs", 500);
    }
});
