/**
 * Task Execution Stream API - Server-Sent Events for real-time task execution updates
 *
 * GET /api/orchestrators/:id/tasks/:taskId/stream
 *
 * Streams execution progress including:
 * - Status changes
 * - Execution steps with command results
 * - Terminal output (buffered for readability)
 * - Tool calls and their results
 * - Completion/failure events
 */

import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";
import { db } from "@/db";
import { orchestratorSessions, tasks, delegations, terminalSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import * as TmuxService from "@/services/tmux-service";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TaskStreamEventType =
  | "connected"        // Initial connection established
  | "status_change"    // Task status changed
  | "step_start"       // Execution step started
  | "step_complete"    // Execution step completed
  | "command"          // Command being executed
  | "output"           // Terminal/command output
  | "tool_call"        // Tool being called
  | "tool_result"      // Tool call result
  | "progress"         // Overall progress update
  | "completed"        // Task completed successfully
  | "failed"           // Task failed
  | "cancelled"        // Task was cancelled
  | "heartbeat"        // Keep-alive ping
  | "error";           // Error in stream

interface ExecutionStep {
  id: string;
  type: "planning" | "setup" | "execution" | "validation" | "cleanup";
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  details?: string;
  error?: string;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

interface StreamEvent {
  type: TaskStreamEventType;
  data: unknown;
  timestamp: string;
}

interface BufferedOutput {
  lines: string[];
  lastUpdate: number;
  sessionId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format an SSE message
 */
function formatSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Buffer terminal output for human readability
 * Groups rapid updates and formats for display
 */
function bufferOutput(
  buffer: BufferedOutput,
  newOutput: string,
  maxLines = 50
): { lines: string[]; shouldFlush: boolean } {
  const now = Date.now();
  const timeSinceLastUpdate = now - buffer.lastUpdate;

  // Split new output into lines
  const newLines = newOutput.split("\n").filter((line) => line.trim());

  // Add to buffer
  buffer.lines.push(...newLines);
  buffer.lastUpdate = now;

  // Keep only last N lines
  if (buffer.lines.length > maxLines) {
    buffer.lines = buffer.lines.slice(-maxLines);
  }

  // Flush if:
  // 1. Buffer has accumulated for > 500ms
  // 2. Buffer has > 20 lines
  // 3. Output contains completion markers
  const shouldFlush =
    timeSinceLastUpdate > 500 ||
    buffer.lines.length > 20 ||
    newOutput.includes("✓") ||
    newOutput.includes("error") ||
    newOutput.includes("Error");

  if (shouldFlush) {
    const linesToSend = [...buffer.lines];
    buffer.lines = [];
    return { lines: linesToSend, shouldFlush: true };
  }

  return { lines: [], shouldFlush: false };
}

/**
 * Parse delegation execution logs for steps and tool calls
 */
function parseExecutionLogs(logsJson: string | null): {
  steps: ExecutionStep[];
  toolCalls: ToolCall[];
} {
  if (!logsJson) {
    return { steps: [], toolCalls: [] };
  }

  try {
    const logs = JSON.parse(logsJson) as Array<{
      type?: string;
      name?: string;
      status?: string;
      timestamp?: string;
      details?: Record<string, unknown>;
    }>;

    const steps: ExecutionStep[] = [];
    const toolCalls: ToolCall[] = [];

    for (const log of logs) {
      if (log.type === "step") {
        steps.push({
          id: `step-${steps.length}`,
          type: (log.details?.type as ExecutionStep["type"]) || "execution",
          name: log.name || "Unknown step",
          status: (log.status as ExecutionStep["status"]) || "pending",
          startedAt: log.timestamp,
          details: log.details?.description as string | undefined,
        });
      } else if (log.type === "tool_call") {
        toolCalls.push({
          id: `tool-${toolCalls.length}`,
          name: log.name || "Unknown tool",
          input: (log.details?.input as Record<string, unknown>) || {},
          startedAt: log.timestamp || new Date().toISOString(),
          result: log.details?.result,
          error: log.details?.error as string | undefined,
        });
      }
    }

    return { steps, toolCalls };
  } catch {
    return { steps: [], toolCalls: [] };
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
): Promise<Response> {
  const { id: orchestratorId, taskId } = await params;

  // Authenticate
  const userId = await authenticateRequest(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify orchestrator exists and belongs to user
  const orchestrator = await db.query.orchestratorSessions.findFirst({
    where: and(
      eq(orchestratorSessions.id, orchestratorId),
      eq(orchestratorSessions.userId, userId)
    ),
  });

  if (!orchestrator) {
    return new Response(JSON.stringify({ error: "Orchestrator not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify task exists and belongs to orchestrator
  const task = await db.query.tasks.findFirst({
    where: and(
      eq(tasks.id, taskId),
      eq(tasks.orchestratorId, orchestratorId)
    ),
  });

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get delegation if task has one
  const delegation = task.delegationId
    ? await db.query.delegations.findFirst({
        where: eq(delegations.id, task.delegationId),
      })
    : null;

  // Create streaming response
  const encoder = new TextEncoder();
  let isClosed = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  const outputBuffer: BufferedOutput = { lines: [], lastUpdate: Date.now() };
  let lastStatus = task.status;
  let lastExecutionLogs = delegation?.executionLogsJson ?? "[]";
  let lastScrollbackHash = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send connected event with initial state
        const { steps, toolCalls } = parseExecutionLogs(delegation?.executionLogsJson ?? null);

        controller.enqueue(
          encoder.encode(
            formatSSE({
              type: "connected",
              data: {
                taskId: task.id,
                status: task.status,
                description: task.description,
                type: task.type,
                assignedAgent: task.assignedAgent,
                steps,
                toolCalls,
              },
              timestamp: new Date().toISOString(),
            })
          )
        );

        // If task is already terminal, send final event and close
        if (["completed", "failed", "cancelled"].includes(task.status)) {
          const finalType =
            task.status === "completed"
              ? "completed"
              : task.status === "failed"
                ? "failed"
                : "cancelled";

          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: finalType,
                data: {
                  taskId: task.id,
                  result: task.resultJson ? JSON.parse(task.resultJson) : null,
                  error: task.errorJson ? JSON.parse(task.errorJson) : null,
                },
                timestamp: new Date().toISOString(),
              })
            )
          );
          controller.close();
          isClosed = true;
          return;
        }

        // Poll for updates every second
        let pollCount = 0;
        const maxPolls = 600; // 10 minutes max

        pollInterval = setInterval(async () => {
          if (isClosed) return;

          pollCount++;

          // Timeout check
          if (pollCount >= maxPolls) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "error",
                  data: { message: "Stream timeout - reconnect if needed" },
                  timestamp: new Date().toISOString(),
                })
              )
            );
            if (pollInterval) clearInterval(pollInterval);
            controller.close();
            isClosed = true;
            return;
          }

          try {
            // Fetch current task state
            const currentTask = await db.query.tasks.findFirst({
              where: eq(tasks.id, taskId),
            });

            if (!currentTask) {
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "error",
                    data: { message: "Task no longer exists" },
                    timestamp: new Date().toISOString(),
                  })
                )
              );
              if (pollInterval) clearInterval(pollInterval);
              controller.close();
              isClosed = true;
              return;
            }

            // Check for status change
            if (currentTask.status !== lastStatus) {
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "status_change",
                    data: {
                      previousStatus: lastStatus,
                      currentStatus: currentTask.status,
                    },
                    timestamp: new Date().toISOString(),
                  })
                )
              );
              lastStatus = currentTask.status;
            }

            // Stream terminal output and check execution logs if delegation exists
            if (currentTask.delegationId) {
              const currentDelegation = await db.query.delegations.findFirst({
                where: eq(delegations.id, currentTask.delegationId),
              });

              // Check for execution logs updates
              if (currentDelegation && currentDelegation.executionLogsJson !== lastExecutionLogs) {
                const { steps: newSteps, toolCalls: newToolCalls } = parseExecutionLogs(
                  currentDelegation.executionLogsJson
                );
                const { steps: oldSteps, toolCalls: oldToolCalls } = parseExecutionLogs(
                  lastExecutionLogs
                );

                // Emit new steps
                for (let i = oldSteps.length; i < newSteps.length; i++) {
                  const step = newSteps[i];
                  controller.enqueue(
                    encoder.encode(
                      formatSSE({
                        type: step.status === "running" ? "step_start" : "step_complete",
                        data: step,
                        timestamp: new Date().toISOString(),
                      })
                    )
                  );
                }

                // Emit new tool calls
                for (let i = oldToolCalls.length; i < newToolCalls.length; i++) {
                  const toolCall = newToolCalls[i];
                  controller.enqueue(
                    encoder.encode(
                      formatSSE({
                        type: toolCall.result || toolCall.error ? "tool_result" : "tool_call",
                        data: toolCall,
                        timestamp: new Date().toISOString(),
                      })
                    )
                  );
                }

                lastExecutionLogs = currentDelegation.executionLogsJson;
              }

              if (currentDelegation?.sessionId) {
                const session = await db.query.terminalSessions.findFirst({
                  where: eq(terminalSessions.id, currentDelegation.sessionId),
                });

                if (session?.tmuxSessionName) {
                  try {
                    const scrollback = await TmuxService.capturePane(session.tmuxSessionName);
                    const scrollbackHash = Buffer.from(scrollback).toString("base64").slice(0, 32);

                    if (scrollbackHash !== lastScrollbackHash) {
                      const { lines, shouldFlush } = bufferOutput(outputBuffer, scrollback);

                      if (shouldFlush && lines.length > 0) {
                        controller.enqueue(
                          encoder.encode(
                            formatSSE({
                              type: "output",
                              data: {
                                sessionId: session.id,
                                lines,
                                lineCount: lines.length,
                              },
                              timestamp: new Date().toISOString(),
                            })
                          )
                        );
                      }

                      lastScrollbackHash = scrollbackHash;
                    }
                  } catch {
                    // Session might not be running
                  }
                }
              }
            }

            // Check for terminal state
            if (["completed", "failed", "cancelled"].includes(currentTask.status)) {
              const finalType =
                currentTask.status === "completed"
                  ? "completed"
                  : currentTask.status === "failed"
                    ? "failed"
                    : "cancelled";

              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: finalType,
                    data: {
                      taskId: currentTask.id,
                      result: currentTask.resultJson ? JSON.parse(currentTask.resultJson) : null,
                      error: currentTask.errorJson ? JSON.parse(currentTask.errorJson) : null,
                    },
                    timestamp: new Date().toISOString(),
                  })
                )
              );

              if (pollInterval) clearInterval(pollInterval);
              controller.close();
              isClosed = true;
              return;
            }

            // Send heartbeat every 15 polls
            if (pollCount % 15 === 0) {
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "heartbeat",
                    data: { pollCount, taskId },
                    timestamp: new Date().toISOString(),
                  })
                )
              );
            }
          } catch (error) {
            console.error("[TaskStream] Poll error:", error);
          }
        }, 1000);
      } catch (error) {
        console.error("[TaskStream] Stream error:", error);
        controller.enqueue(
          encoder.encode(
            formatSSE({
              type: "error",
              data: {
                message: error instanceof Error ? error.message : "Unknown error",
              },
              timestamp: new Date().toISOString(),
            })
          )
        );
        controller.close();
        isClosed = true;
      }
    },
    cancel() {
      isClosed = true;
      if (pollInterval) clearInterval(pollInterval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
