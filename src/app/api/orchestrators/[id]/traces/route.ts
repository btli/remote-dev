/**
 * Trace API - Get tool call traces for debugging
 *
 * GET /api/orchestrators/:id/traces
 *
 * Returns tool call trace data for visualization in TraceViewer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";
import { db } from "@/db";
import { orchestratorSessions, delegations, tasks, terminalSessions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ToolCall, ToolCallStatus, TraceData } from "@/components/orchestrator/TraceViewer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionLogEntry {
  type?: string;
  name?: string;
  status?: string;
  timestamp?: string;
  details?: {
    type?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    error?: string;
    duration?: number;
    parentId?: string;
    [key: string]: unknown;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate request
 */
async function authenticateRequest(request: Request): Promise<string | null> {
  const session = await getAuthSession();
  if (session?.user?.id) {
    return session.user.id;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.substring(7);
    const validated = await ApiKeyService.validateApiKey(apiKey);
    if (validated) {
      return validated.userId;
    }
  }

  return null;
}

/**
 * Parse execution logs to extract tool calls
 */
function parseExecutionLogs(logsJson: string | null): ToolCall[] {
  if (!logsJson) return [];

  try {
    const logs = JSON.parse(logsJson) as ExecutionLogEntry[];
    const toolCalls: ToolCall[] = [];

    for (const log of logs) {
      if (log.type === "tool_call") {
        const status: ToolCallStatus =
          log.status === "success" ? "success" :
          log.status === "error" ? "error" :
          log.status === "timeout" ? "timeout" :
          log.status === "running" ? "running" :
          "pending";

        toolCalls.push({
          id: `tool-${toolCalls.length}`,
          name: log.name || "Unknown tool",
          input: (log.details?.input as Record<string, unknown>) || {},
          output: log.details?.output,
          error: log.details?.error as string | undefined,
          status,
          startedAt: new Date(log.timestamp || Date.now()),
          completedAt: log.details?.duration
            ? new Date((log.timestamp ? new Date(log.timestamp).getTime() : Date.now()) + (log.details.duration as number))
            : undefined,
          duration: log.details?.duration as number | undefined,
          parentId: log.details?.parentId as string | undefined,
        });
      }
    }

    return toolCalls;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: orchestratorId } = await params;

  // Authenticate
  const userId = await authenticateRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify orchestrator exists and belongs to user
  const orchestrator = await db.query.orchestratorSessions.findFirst({
    where: and(
      eq(orchestratorSessions.id, orchestratorId),
      eq(orchestratorSessions.userId, userId)
    ),
  });

  if (!orchestrator) {
    return NextResponse.json({ error: "Orchestrator not found" }, { status: 404 });
  }

  // Get query parameters
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const sessionId = searchParams.get("sessionId");
  const limit = parseInt(searchParams.get("limit") || "100", 10);

  // Build query conditions
  const traces: TraceData[] = [];

  if (taskId) {
    // Get traces for specific task
    const task = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, taskId),
        eq(tasks.orchestratorId, orchestratorId)
      ),
    });

    if (task && task.delegationId) {
      const delegation = await db.query.delegations.findFirst({
        where: eq(delegations.id, task.delegationId),
      });

      if (delegation) {
        const calls = parseExecutionLogs(delegation.executionLogsJson);
        traces.push({
          id: `trace-${task.id}`,
          taskId: task.id,
          sessionId: delegation.sessionId || undefined,
          calls,
          startedAt: task.createdAt,
          completedAt: task.completedAt || undefined,
          status: task.status === "completed" ? "completed" :
                  task.status === "failed" || task.status === "cancelled" ? "failed" :
                  "running",
        });
      }
    }
  } else if (sessionId) {
    // Get traces for specific session
    const session = await db.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      ),
    });

    if (session) {
      // Find delegations for this session
      const sessionDelegations = await db.query.delegations.findMany({
        where: eq(delegations.sessionId, sessionId),
        orderBy: [desc(delegations.createdAt)],
        limit,
      });

      for (const delegation of sessionDelegations) {
        const calls = parseExecutionLogs(delegation.executionLogsJson);
        if (calls.length > 0) {
          traces.push({
            id: `trace-${delegation.id}`,
            taskId: delegation.taskId || undefined,
            sessionId,
            calls,
            startedAt: delegation.createdAt,
            completedAt: delegation.completedAt || undefined,
            status: delegation.status === "completed" ? "completed" :
                    delegation.status === "failed" ? "failed" :
                    "running",
          });
        }
      }
    }
  } else {
    // Get recent traces for all tasks in this orchestrator
    const recentTasks = await db.query.tasks.findMany({
      where: eq(tasks.orchestratorId, orchestratorId),
      orderBy: [desc(tasks.createdAt)],
      limit,
    });

    for (const task of recentTasks) {
      if (task.delegationId) {
        const delegation = await db.query.delegations.findFirst({
          where: eq(delegations.id, task.delegationId),
        });

        if (delegation) {
          const calls = parseExecutionLogs(delegation.executionLogsJson);
          if (calls.length > 0) {
            traces.push({
              id: `trace-${task.id}`,
              taskId: task.id,
              sessionId: delegation.sessionId || undefined,
              calls,
              startedAt: task.createdAt,
              completedAt: task.completedAt || undefined,
              status: task.status === "completed" ? "completed" :
                      task.status === "failed" || task.status === "cancelled" ? "failed" :
                      "running",
            });
          }
        }
      }
    }
  }

  return NextResponse.json({
    traces,
    total: traces.length,
    orchestratorId,
  });
}
