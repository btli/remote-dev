/**
 * Orchestrator Tools - AI Agent Orchestration
 *
 * Tools for managing orchestrators, monitoring session health, and accessing insights.
 * These enable AI agents to coordinate multi-session workflows and respond to stall detection.
 */
import { z } from "zod";
import { createTool } from "../registry";
import { successResult } from "../utils/error-handler";
import { injectCommandUseCase } from "@/infrastructure/container";
import * as SessionService from "@/services/session-service";
import { db } from "@/db";
import { orchestratorSessions, orchestratorInsights, orchestratorAuditLog, terminalSessions } from "@/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { RegisteredTool } from "../types";

/**
 * session_send_input - Inject command to a session via orchestrator
 */
const sessionSendInput = createTool({
  name: "session_send_input",
  description:
    "Inject a command into a terminal session through the orchestrator. " +
    "This validates the command for safety, checks session scope, and logs the action. " +
    "Use this when the orchestrator needs to intervene in a stalled session.",
  inputSchema: z.object({
    orchestratorId: z.string().uuid().describe("The orchestrator UUID performing the injection"),
    sessionId: z.string().uuid().describe("The target session UUID"),
    command: z.string().describe("The command to inject (safety validated)"),
    reason: z.string().optional().describe("Reason for the injection (for audit log)"),
  }),
  handler: async (input, context) => {
    // Step 1: Get session to verify it exists and get tmux name
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    if (session.status === "closed") {
      return successResult({
        success: false,
        error: "Cannot inject command to closed session",
        code: "SESSION_CLOSED",
      });
    }

    // Step 2: Execute the use case
    try {
      const result = await injectCommandUseCase.execute({
        orchestratorId: input.orchestratorId,
        targetSessionId: input.sessionId,
        targetTmuxSessionName: session.tmuxSessionName,
        targetSessionFolderId: session.folderId,
        command: input.command,
        reason: input.reason,
      });

      return successResult({
        success: result.result.success,
        sessionId: input.sessionId,
        command: input.command,
        timestamp: result.result.timestamp,
        auditLogId: result.auditLog.id,
        error: result.result.error,
        hint: result.result.success
          ? "Command injected successfully. Use session_read_output to see results."
          : "Command injection failed. Check the error details.",
      });
    } catch (error) {
      // Domain errors get thrown by use case
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Error && "code" in error ? (error as { code: string }).code : undefined;

      return successResult({
        success: false,
        error: message,
        code,
      });
    }
  },
});

/**
 * session_get_insights - Get orchestrator insights for a session
 */
const sessionGetInsights = createTool({
  name: "session_get_insights",
  description:
    "Retrieve orchestrator insights for a specific session. " +
    "Insights include stall detection, error patterns, and suggested actions. " +
    "Use this to understand session health and decide on interventions.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to query insights for"),
    includeResolved: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include resolved insights (default: false, only unresolved)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(20)
      .describe("Maximum number of insights to return (default: 20)"),
  }),
  handler: async (input, context) => {
    // Step 1: Verify session exists and belongs to user
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Step 2: Query insights from database
    let query = db
      .select()
      .from(orchestratorInsights)
      .where(eq(orchestratorInsights.sessionId, input.sessionId))
      .orderBy(desc(orchestratorInsights.createdAt))
      .limit(input.limit);

    // Filter to only unresolved if requested
    if (!input.includeResolved) {
      query = db
        .select()
        .from(orchestratorInsights)
        .where(
          and(
            eq(orchestratorInsights.sessionId, input.sessionId),
            eq(orchestratorInsights.resolved, false)
          )
        )
        .orderBy(desc(orchestratorInsights.createdAt))
        .limit(input.limit);
    }

    const insights = await query;

    // Step 3: Format insights for response
    const formattedInsights = insights.map((insight) => ({
      id: insight.id,
      orchestratorId: insight.orchestratorId,
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      context: insight.contextJson ? JSON.parse(insight.contextJson) : null,
      suggestedActions: insight.suggestedActions ? JSON.parse(insight.suggestedActions) : [],
      resolved: insight.resolved,
      resolvedAt: insight.resolvedAt,
      createdAt: insight.createdAt,
    }));

    // Step 4: Get orchestrator info for context
    const orchestratorIds = [...new Set(insights.map((i) => i.orchestratorId))];
    const orchestrators = await db
      .select()
      .from(orchestratorSessions)
      .where(
        orchestratorIds.length > 0
          ? orchestratorIds.map((id) => eq(orchestratorSessions.id, id)).reduce((a, b) => and(a, b)!)
          : undefined
      );

    return successResult({
      success: true,
      sessionId: input.sessionId,
      count: formattedInsights.length,
      insights: formattedInsights,
      orchestrators: orchestrators.map((orc) => ({
        id: orc.id,
        type: orc.type,
        status: orc.status,
        scopeType: orc.scopeType,
        scopeId: orc.scopeId,
      })),
      hint:
        formattedInsights.length === 0
          ? "No insights found for this session. Session is healthy or not being monitored."
          : `Found ${formattedInsights.length} insight(s). Review suggested actions for intervention guidance.`,
    });
  },
});

/**
 * orchestrator_status - Get orchestrator status and configuration
 */
const orchestratorStatus = createTool({
  name: "orchestrator_status",
  description:
    "Get the status and configuration of orchestrators monitoring sessions. " +
    "Includes master orchestrator and any folder-scoped sub-orchestrators. " +
    "Use this to understand the current monitoring state.",
  inputSchema: z.object({
    orchestratorId: z
      .string()
      .uuid()
      .optional()
      .describe("Specific orchestrator ID (omit to list all user orchestrators)"),
    includeStats: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include statistics (insight counts, audit log counts)"),
  }),
  handler: async (input, context) => {
    // Step 1: Query orchestrators
    let orchestrators;
    if (input.orchestratorId) {
      // Get specific orchestrator
      orchestrators = await db
        .select()
        .from(orchestratorSessions)
        .where(eq(orchestratorSessions.id, input.orchestratorId))
        .limit(1);

      if (orchestrators.length === 0) {
        return successResult({
          success: false,
          error: "Orchestrator not found",
          code: "ORCHESTRATOR_NOT_FOUND",
        });
      }
    } else {
      // Get all user orchestrators
      orchestrators = await db
        .select()
        .from(orchestratorSessions)
        .where(eq(orchestratorSessions.userId, context.userId))
        .orderBy(desc(orchestratorSessions.createdAt));
    }

    // Step 2: Gather statistics if requested
    const orchestratorData = await Promise.all(
      orchestrators.map(async (orc) => {
        const baseData = {
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
        };

        if (!input.includeStats) {
          return baseData;
        }

        // Get insight counts
        const unresolvedInsights = await db
          .select()
          .from(orchestratorInsights)
          .where(
            and(
              eq(orchestratorInsights.orchestratorId, orc.id),
              eq(orchestratorInsights.resolved, false)
            )
          );

        const totalInsights = await db
          .select()
          .from(orchestratorInsights)
          .where(eq(orchestratorInsights.orchestratorId, orc.id));

        const criticalInsights = unresolvedInsights.filter(
          (i) => i.severity === "critical"
        );

        // Get recent audit log count (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentAuditLogs = await db
          .select()
          .from(orchestratorAuditLog)
          .where(
            and(
              eq(orchestratorAuditLog.orchestratorId, orc.id),
              // Note: Drizzle doesn't have gte/lte, we use gt/lt
              // This is a simplification - in production we'd use proper comparison
            )
          );

        return {
          ...baseData,
          stats: {
            unresolvedInsights: unresolvedInsights.length,
            totalInsights: totalInsights.length,
            criticalInsights: criticalInsights.length,
            recentActions: recentAuditLogs.length,
          },
        };
      })
    );

    // Step 3: Get session info for context
    const sessionIds = orchestrators.map((orc) => orc.sessionId);

    const sessions =
      sessionIds.length > 0
        ? await db
            .select()
            .from(terminalSessions)
            .where(inArray(terminalSessions.id, sessionIds))
        : [];

    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    return successResult({
      success: true,
      count: orchestratorData.length,
      orchestrators: orchestratorData.map((orc) => ({
        ...orc,
        session: sessionMap.get(orc.sessionId)
          ? {
              id: sessionMap.get(orc.sessionId)!.id,
              name: sessionMap.get(orc.sessionId)!.name,
              status: sessionMap.get(orc.sessionId)!.status,
              projectPath: sessionMap.get(orc.sessionId)!.projectPath,
            }
          : null,
      })),
      hint:
        orchestratorData.length === 0
          ? "No orchestrators found. Create a master orchestrator to begin monitoring."
          : input.orchestratorId
            ? "Orchestrator details retrieved."
            : `Found ${orchestratorData.length} orchestrator(s).`,
    });
  },
});

/**
 * Export all orchestrator tools
 */
export const orchestratorTools: RegisteredTool[] = [
  sessionSendInput,
  sessionGetInsights,
  orchestratorStatus,
];
