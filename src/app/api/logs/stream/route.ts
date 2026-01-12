/**
 * Log Stream API - Server-Sent Events endpoint for real-time log streaming
 *
 * GET /api/logs/stream?sessionId=xxx
 *
 * Streams execution logs in real-time for a specific session or all sessions.
 */

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { terminalSessions, delegations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

// Log entry structure for streaming
interface StreamLogEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: "agent" | "system" | "command" | "output" | "user";
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
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // Parse query params
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  // Set up SSE response
  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastLogCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      const initialMessage: StreamLogEntry = {
        id: `log-${Date.now()}-init`,
        timestamp: new Date().toISOString(),
        level: "info",
        source: "system",
        message: `Log stream connected${sessionId ? ` for session ${sessionId.slice(0, 8)}...` : ""}`,
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialMessage)}\n\n`));

      // Function to fetch and send new logs
      const sendLogs = async () => {
        try {
          // Build query conditions
          const conditions = [eq(terminalSessions.userId, userId)];
          if (sessionId) {
            conditions.push(eq(terminalSessions.id, sessionId));
          }

          // Fetch recent delegations with execution logs
          const recentDelegations = await db
            .select({
              id: delegations.id,
              sessionId: delegations.sessionId,
              executionLogsJson: delegations.executionLogsJson,
              agentProvider: delegations.agentProvider,
              status: delegations.status,
              updatedAt: delegations.updatedAt,
            })
            .from(delegations)
            .innerJoin(
              terminalSessions,
              eq(delegations.sessionId, terminalSessions.id)
            )
            .where(and(...conditions))
            .orderBy(desc(delegations.updatedAt))
            .limit(10);

          // Parse and stream new logs
          for (const delegation of recentDelegations) {
            try {
              const logs = JSON.parse(delegation.executionLogsJson || "[]") as Array<{
                timestamp: string;
                level: string;
                message: string;
                metadata?: Record<string, unknown>;
              }>;

              // Check if there are new logs
              if (logs.length > lastLogCount) {
                const newLogs = logs.slice(lastLogCount);
                lastLogCount = logs.length;

                for (const log of newLogs) {
                  const entry: StreamLogEntry = {
                    id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    timestamp: log.timestamp || new Date().toISOString(),
                    level: (log.level as StreamLogEntry["level"]) || "info",
                    source: "agent",
                    message: log.message || "",
                    metadata: log.metadata,
                    sessionId: delegation.sessionId,
                  };

                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)
                  );
                }
              }
            } catch {
              // Invalid JSON, skip
            }
          }

          // Send heartbeat to keep connection alive
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch (error) {
          console.error("[LogStream] Error fetching logs:", error);
        }
      };

      // Poll for new logs every 2 seconds
      intervalId = setInterval(sendLogs, 2000);

      // Initial fetch
      await sendLogs();
    },

    cancel() {
      // Clean up interval when stream is closed
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
