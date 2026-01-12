/**
 * Logs API - Fetch execution logs
 *
 * GET /api/logs?sessionId=xxx&limit=100&level=error
 *
 * Fetches execution logs from delegations and orchestrator activity.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  terminalSessions,
  delegations,
  orchestratorAuditLog,
  orchestratorSessions,
} from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

// Define types locally to avoid client component import
type LogLevel = "debug" | "info" | "warn" | "error";
type LogSource = "agent" | "system" | "command" | "output" | "user";

interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  command?: string;
  duration?: number;
}

export async function GET(request: NextRequest) {
  // Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse query params
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  const orchestratorId = searchParams.get("orchestratorId");
  const folderId = searchParams.get("folderId");
  const level = searchParams.get("level") as LogLevel | null;
  const source = searchParams.get("source") as LogSource | null;
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 1000);

  const logs: LogEntry[] = [];

  try {
    // Fetch execution logs from delegations
    if (!orchestratorId) {
      const delegationConditions = [];

      if (sessionId) {
        delegationConditions.push(eq(delegations.sessionId, sessionId));
      } else if (folderId) {
        // Get sessions in this folder
        const folderSessions = await db
          .select({ id: terminalSessions.id })
          .from(terminalSessions)
          .where(
            and(
              eq(terminalSessions.userId, userId),
              eq(terminalSessions.folderId, folderId)
            )
          );

        if (folderSessions.length > 0) {
          delegationConditions.push(
            inArray(
              delegations.sessionId,
              folderSessions.map((s) => s.id)
            )
          );
        }
      } else {
        // Get all user's sessions
        const userSessions = await db
          .select({ id: terminalSessions.id })
          .from(terminalSessions)
          .where(eq(terminalSessions.userId, userId));

        if (userSessions.length > 0) {
          delegationConditions.push(
            inArray(
              delegations.sessionId,
              userSessions.map((s) => s.id)
            )
          );
        }
      }

      if (delegationConditions.length > 0) {
        const recentDelegations = await db
          .select({
            id: delegations.id,
            sessionId: delegations.sessionId,
            executionLogsJson: delegations.executionLogsJson,
            agentProvider: delegations.agentProvider,
            status: delegations.status,
            createdAt: delegations.createdAt,
          })
          .from(delegations)
          .where(and(...delegationConditions))
          .orderBy(desc(delegations.createdAt))
          .limit(20);

        // Parse execution logs from each delegation
        for (const delegation of recentDelegations) {
          try {
            const executionLogs = JSON.parse(
              delegation.executionLogsJson || "[]"
            ) as Array<{
              timestamp?: string;
              level?: string;
              message?: string;
              metadata?: Record<string, unknown>;
            }>;

            for (const log of executionLogs) {
              const logLevel = (log.level as LogLevel) || "info";
              const logSource: LogSource = "agent";

              // Apply level filter
              if (level && logLevel !== level) continue;
              // Apply source filter
              if (source && logSource !== source) continue;

              logs.push({
                id: `${delegation.id}-${logs.length}`,
                timestamp: new Date(log.timestamp || delegation.createdAt),
                level: logLevel,
                source: logSource,
                message: log.message || "",
                metadata: log.metadata,
                sessionId: delegation.sessionId,
              });
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    }

    // Fetch orchestrator audit logs
    const auditConditions = [];

    if (orchestratorId) {
      auditConditions.push(eq(orchestratorAuditLog.orchestratorId, orchestratorId));
    } else {
      // Get user's orchestrators
      const userOrchestrators = await db
        .select({ id: orchestratorSessions.id })
        .from(orchestratorSessions)
        .where(eq(orchestratorSessions.userId, userId));

      if (userOrchestrators.length > 0) {
        auditConditions.push(
          inArray(
            orchestratorAuditLog.orchestratorId,
            userOrchestrators.map((o) => o.id)
          )
        );
      }
    }

    if (auditConditions.length > 0) {
      const auditLogs = await db
        .select()
        .from(orchestratorAuditLog)
        .where(and(...auditConditions))
        .orderBy(desc(orchestratorAuditLog.createdAt))
        .limit(limit);

      for (const audit of auditLogs) {
        // Determine log level from action type
        let logLevel: LogLevel = "info";
        if (audit.actionType === "insight_generated") {
          logLevel = "warn";
        } else if (audit.actionType === "command_injected") {
          logLevel = "info";
        }

        const logSource: LogSource = "system";

        // Apply level filter
        if (level && logLevel !== level) continue;
        // Apply source filter
        if (source && logSource !== source) continue;

        const details = audit.detailsJson
          ? (JSON.parse(audit.detailsJson) as Record<string, unknown>)
          : undefined;

        logs.push({
          id: audit.id,
          timestamp: audit.createdAt,
          level: logLevel,
          source: logSource,
          message: formatAuditMessage(audit.actionType, details),
          metadata: details,
          sessionId: audit.targetSessionId ?? undefined,
        });
      }
    }

    // Sort logs by timestamp descending
    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    const limitedLogs = logs.slice(0, limit);

    return NextResponse.json({
      logs: limitedLogs,
      total: logs.length,
      hasMore: logs.length > limit,
    });
  } catch (error) {
    console.error("[LogsAPI] Error fetching logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}

/**
 * Format audit log action type into human-readable message
 */
function formatAuditMessage(
  actionType: string,
  details?: Record<string, unknown>
): string {
  switch (actionType) {
    case "command_injected":
      return `Command injected: ${details?.command || "unknown"}`;
    case "status_changed":
      return `Status changed to: ${details?.newStatus || "unknown"}`;
    case "insight_generated":
      return `Insight generated: ${details?.title || "unknown"}`;
    case "session_monitored":
      return "Session monitoring cycle completed";
    case "config_changed":
      return `Configuration changed: ${details?.field || "unknown"}`;
    default:
      return `${actionType.replace(/_/g, " ")}`;
  }
}
