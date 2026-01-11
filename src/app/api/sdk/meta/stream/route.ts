/**
 * SDK Meta-Agent SSE Stream API Route
 *
 * GET /api/sdk/meta/stream?jobId=xxx - Stream optimization progress via SSE
 *
 * Server-Sent Events stream for real-time optimization progress.
 * Sends events as the optimization job progresses through iterations.
 */

import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";
import { db } from "@/db";
import { sdkMetaAgentOptimizationJobs } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * SSE Event Types
 */
type SSEEventType =
  | "connected"      // Initial connection established
  | "status"         // Status update (pending → running, etc.)
  | "progress"       // Iteration progress update
  | "score"          // Score update
  | "iteration"      // Full iteration snapshot
  | "completed"      // Job completed successfully
  | "failed"         // Job failed
  | "cancelled"      // Job was cancelled
  | "heartbeat"      // Keep-alive ping
  | "error";         // Error in stream

interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

/**
 * Format an SSE message
 */
function formatSSE(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * GET /api/sdk/meta/stream - Stream optimization progress
 *
 * Query parameters:
 * - jobId: Required - The optimization job ID to stream
 *
 * Returns Server-Sent Events stream with:
 * - connected: Initial connection with job status
 * - progress: Iteration progress updates
 * - score: Score changes
 * - completed/failed/cancelled: Terminal states
 * - heartbeat: Keep-alive every 15 seconds
 */
/**
 * Authenticate request (supports session and API key auth)
 */
async function authenticateRequest(request: Request): Promise<string | null> {
  // Try session auth first
  const session = await getAuthSession();
  if (session?.user?.id) {
    return session.user.id;
  }

  // Try API key auth
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

export async function GET(request: Request): Promise<Response> {
  // Authenticate manually (withApiAuth expects NextResponse)
  const userId = await authenticateRequest(request);
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: "jobId query parameter is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Verify job exists and belongs to user
  const job = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
    where: and(
      eq(sdkMetaAgentOptimizationJobs.id, jobId),
      eq(sdkMetaAgentOptimizationJobs.userId, userId)
    ),
  });

  if (!job) {
    return new Response(
      JSON.stringify({ error: "Optimization job not found" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // If job is already terminal, return final state immediately
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send connected event with final status
        controller.enqueue(
          encoder.encode(
            formatSSE({
              type: "connected",
              data: {
                jobId: job.id,
                status: job.status,
                isTerminal: true,
              },
              timestamp: new Date().toISOString(),
            })
          )
        );

        // Send final event
        const finalEvent: SSEEventType =
          job.status === "completed"
            ? "completed"
            : job.status === "failed"
              ? "failed"
              : "cancelled";

        controller.enqueue(
          encoder.encode(
            formatSSE({
              type: finalEvent,
              data: {
                jobId: job.id,
                status: job.status,
                finalScore: job.currentScore,
                stopReason: job.stopReason,
                configId: job.configId,
                error: job.errorMessage,
                iterations: job.currentIteration,
              },
              timestamp: new Date().toISOString(),
            })
          )
        );

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // For non-terminal jobs, create polling stream
  const encoder = new TextEncoder();
  let lastIteration = job.currentIteration;
  let lastScore = job.currentScore;
  let lastStatus = job.status;
  let pollCount = 0;
  const maxPollCount = 300; // 5 minutes at 1 second intervals
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send connected event
        controller.enqueue(
          encoder.encode(
            formatSSE({
              type: "connected",
              data: {
                jobId: job.id,
                status: job.status,
                currentIteration: job.currentIteration,
                maxIterations: job.maxIterations,
                currentScore: job.currentScore,
                targetScore: job.targetScore,
              },
              timestamp: new Date().toISOString(),
            })
          )
        );

        // Poll for updates
        const pollInterval = setInterval(async () => {
          if (isClosed) {
            clearInterval(pollInterval);
            return;
          }

          pollCount++;

          // Check for timeout
          if (pollCount >= maxPollCount) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "error",
                  data: {
                    message: "Stream timeout - reconnect if needed",
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );
            clearInterval(pollInterval);
            controller.close();
            isClosed = true;
            return;
          }

          // Fetch latest job state
          const currentJob = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
            where: and(
              eq(sdkMetaAgentOptimizationJobs.id, jobId),
              eq(sdkMetaAgentOptimizationJobs.userId, userId)
            ),
          });

          if (!currentJob) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "error",
                  data: { message: "Job no longer exists" },
                  timestamp: new Date().toISOString(),
                })
              )
            );
            clearInterval(pollInterval);
            controller.close();
            isClosed = true;
            return;
          }

          // Check for status change
          if (currentJob.status !== lastStatus) {
            lastStatus = currentJob.status;
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "status",
                  data: {
                    previousStatus: lastStatus,
                    currentStatus: currentJob.status,
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );
          }

          // Check for iteration progress
          if (currentJob.currentIteration !== lastIteration) {
            const iterationHistory = JSON.parse(currentJob.iterationHistoryJson) as Array<{
              iteration: number;
              score: number;
              configVersion: number;
              suggestionsApplied: number;
              iterationDurationMs: number;
            }>;

            // Send progress event
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "progress",
                  data: {
                    previousIteration: lastIteration,
                    currentIteration: currentJob.currentIteration,
                    maxIterations: currentJob.maxIterations,
                    percentage: Math.round(
                      (currentJob.currentIteration / currentJob.maxIterations) * 100
                    ),
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );

            // Send latest iteration snapshot if available
            if (iterationHistory.length > 0) {
              const latestIteration = iterationHistory[iterationHistory.length - 1];
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "iteration",
                    data: latestIteration,
                    timestamp: new Date().toISOString(),
                  })
                )
              );
            }

            lastIteration = currentJob.currentIteration;
          }

          // Check for score change
          if (currentJob.currentScore !== lastScore) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "score",
                  data: {
                    previousScore: lastScore,
                    currentScore: currentJob.currentScore,
                    targetScore: currentJob.targetScore,
                    reachedTarget:
                      currentJob.currentScore !== null &&
                      currentJob.currentScore >= currentJob.targetScore,
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );
            lastScore = currentJob.currentScore;
          }

          // Check for terminal state
          if (["completed", "failed", "cancelled"].includes(currentJob.status)) {
            const finalEvent: SSEEventType =
              currentJob.status === "completed"
                ? "completed"
                : currentJob.status === "failed"
                  ? "failed"
                  : "cancelled";

            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: finalEvent,
                  data: {
                    jobId: currentJob.id,
                    status: currentJob.status,
                    finalScore: currentJob.currentScore,
                    stopReason: currentJob.stopReason,
                    configId: currentJob.configId,
                    error: currentJob.errorMessage,
                    iterations: currentJob.currentIteration,
                    totalDurationMs: currentJob.completedAt && currentJob.startedAt
                      ? currentJob.completedAt.getTime() - currentJob.startedAt.getTime()
                      : null,
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );

            clearInterval(pollInterval);
            controller.close();
            isClosed = true;
            return;
          }

          // Send heartbeat every 15 seconds
          if (pollCount % 15 === 0) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "heartbeat",
                  data: {
                    pollCount,
                    jobId,
                    status: currentJob.status,
                  },
                  timestamp: new Date().toISOString(),
                })
              )
            );
          }
        }, 1000); // Poll every second
      } catch (error) {
        console.error("SSE stream error:", error);
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
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
