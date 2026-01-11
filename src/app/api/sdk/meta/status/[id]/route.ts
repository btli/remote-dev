/**
 * SDK Meta-Agent Status API Route
 *
 * GET /api/sdk/meta/status/[id] - Get optimization job status and progress
 * DELETE /api/sdk/meta/status/[id] - Cancel a running optimization job
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { db } from "@/db";
import { sdkMetaAgentOptimizationJobs } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/sdk/meta/status/[id] - Get optimization job status
 *
 * Returns the current status of an optimization job including:
 * - status: pending | running | completed | failed | cancelled
 * - progress: currentIteration / maxIterations
 * - scores: currentScore, targetScore, scoreHistory
 * - timing: startedAt, completedAt, duration
 * - result: configId (if completed), error (if failed)
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const jobId = params?.id;
    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const job = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
      where: and(
        eq(sdkMetaAgentOptimizationJobs.id, jobId),
        eq(sdkMetaAgentOptimizationJobs.userId, userId)
      ),
    });

    if (!job) {
      return NextResponse.json({ error: "Optimization job not found" }, { status: 404 });
    }

    // Parse JSON fields
    const scoreHistory = JSON.parse(job.scoreHistoryJson) as number[];
    const iterationHistory = JSON.parse(job.iterationHistoryJson) as Array<{
      iteration: number;
      score: number;
      configVersion: number;
      suggestionsApplied: number;
      iterationDurationMs: number;
    }>;

    // Calculate duration
    let durationMs: number | null = null;
    if (job.startedAt) {
      const endTime = job.completedAt || new Date();
      durationMs = endTime.getTime() - job.startedAt.getTime();
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: {
        currentIteration: job.currentIteration,
        maxIterations: job.maxIterations,
        percentage: job.maxIterations > 0
          ? Math.round((job.currentIteration / job.maxIterations) * 100)
          : 0,
      },
      scores: {
        current: job.currentScore,
        target: job.targetScore,
        history: scoreHistory,
        reachedTarget: job.currentScore !== null && job.currentScore >= job.targetScore,
      },
      iterations: iterationHistory,
      timing: {
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs,
      },
      result: job.status === "completed"
        ? {
            configId: job.configId,
            stopReason: job.stopReason,
            finalScore: job.currentScore,
          }
        : job.status === "failed"
          ? {
              error: job.errorMessage,
              stopReason: job.stopReason,
            }
          : null,
      // Include context for debugging
      context: {
        folderId: job.folderId,
        sessionId: job.sessionId,
      },
    });
  } catch (error) {
    console.error("Failed to get optimization status:", error);
    return NextResponse.json(
      { error: "Failed to get optimization status" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/sdk/meta/status/[id] - Cancel optimization job
 *
 * Cancels a pending or running optimization job.
 * Jobs that are already completed, failed, or cancelled cannot be cancelled.
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  try {
    const jobId = params?.id;
    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const job = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
      where: and(
        eq(sdkMetaAgentOptimizationJobs.id, jobId),
        eq(sdkMetaAgentOptimizationJobs.userId, userId)
      ),
    });

    if (!job) {
      return NextResponse.json({ error: "Optimization job not found" }, { status: 404 });
    }

    // Check if job can be cancelled
    if (job.status !== "pending" && job.status !== "running") {
      return NextResponse.json(
        { error: `Cannot cancel job with status: ${job.status}` },
        { status: 400 }
      );
    }

    // Update job status to cancelled
    await db
      .update(sdkMetaAgentOptimizationJobs)
      .set({
        status: "cancelled",
        stopReason: "cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sdkMetaAgentOptimizationJobs.id, jobId),
          eq(sdkMetaAgentOptimizationJobs.userId, userId)
        )
      );

    return NextResponse.json({
      id: jobId,
      status: "cancelled",
      message: "Optimization job cancelled successfully",
    });
  } catch (error) {
    console.error("Failed to cancel optimization job:", error);
    return NextResponse.json(
      { error: "Failed to cancel optimization job" },
      { status: 500 }
    );
  }
});
