/**
 * SDK Meta-Agent History API Route
 *
 * GET /api/sdk/meta/history - List past optimization jobs with filtering
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { db } from "@/db";
import { sdkMetaAgentOptimizationJobs, sdkMetaAgentConfigs } from "@/db/schema";
import { eq, and, desc, inArray, gte, lte, sql } from "drizzle-orm";

/**
 * Optimization history query parameters
 */
interface HistoryQueryParams {
  status?: string;  // Comma-separated list of statuses
  folderId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  minScore?: number;
  sortBy?: "createdAt" | "completedAt" | "score";
  sortOrder?: "asc" | "desc";
}

/**
 * GET /api/sdk/meta/history - List past optimization jobs
 *
 * Query parameters:
 * - status: Filter by status (can be comma-separated for multiple)
 * - folderId: Filter by folder
 * - sessionId: Filter by session
 * - limit: Maximum results (default: 50, max: 200)
 * - offset: Pagination offset
 * - startDate: Filter by created date (ISO string)
 * - endDate: Filter by created date (ISO string)
 * - minScore: Filter by minimum final score
 * - sortBy: Sort field (createdAt, completedAt, score)
 * - sortOrder: Sort direction (asc, desc)
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const params: HistoryQueryParams = {
      status: url.searchParams.get("status") || undefined,
      folderId: url.searchParams.get("folderId") || undefined,
      sessionId: url.searchParams.get("sessionId") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10),
      startDate: url.searchParams.get("startDate") || undefined,
      endDate: url.searchParams.get("endDate") || undefined,
      minScore: url.searchParams.get("minScore")
        ? parseFloat(url.searchParams.get("minScore")!)
        : undefined,
      sortBy: (url.searchParams.get("sortBy") as HistoryQueryParams["sortBy"]) || "createdAt",
      sortOrder: (url.searchParams.get("sortOrder") as HistoryQueryParams["sortOrder"]) || "desc",
    };

    // Clamp limit
    const limit = Math.min(Math.max(1, params.limit || 50), 200);
    const offset = Math.max(0, params.offset || 0);

    // Build conditions
    const conditions = [eq(sdkMetaAgentOptimizationJobs.userId, userId)];

    // Status filter
    if (params.status) {
      const statuses = params.status.split(",") as Array<
        "pending" | "running" | "completed" | "failed" | "cancelled"
      >;
      if (statuses.length === 1) {
        conditions.push(eq(sdkMetaAgentOptimizationJobs.status, statuses[0]));
      } else if (statuses.length > 1) {
        conditions.push(inArray(sdkMetaAgentOptimizationJobs.status, statuses));
      }
    }

    // Folder filter
    if (params.folderId) {
      conditions.push(eq(sdkMetaAgentOptimizationJobs.folderId, params.folderId));
    }

    // Session filter
    if (params.sessionId) {
      conditions.push(eq(sdkMetaAgentOptimizationJobs.sessionId, params.sessionId));
    }

    // Date filters
    if (params.startDate) {
      const startDate = new Date(params.startDate);
      conditions.push(gte(sdkMetaAgentOptimizationJobs.createdAt, startDate));
    }
    if (params.endDate) {
      const endDate = new Date(params.endDate);
      conditions.push(lte(sdkMetaAgentOptimizationJobs.createdAt, endDate));
    }

    // Score filter
    if (params.minScore !== undefined) {
      conditions.push(gte(sdkMetaAgentOptimizationJobs.currentScore, params.minScore));
    }

    // Build order by
    let orderBy;
    const sortDesc = params.sortOrder === "desc";
    switch (params.sortBy) {
      case "completedAt":
        orderBy = sortDesc
          ? desc(sdkMetaAgentOptimizationJobs.completedAt)
          : sdkMetaAgentOptimizationJobs.completedAt;
        break;
      case "score":
        orderBy = sortDesc
          ? desc(sdkMetaAgentOptimizationJobs.currentScore)
          : sdkMetaAgentOptimizationJobs.currentScore;
        break;
      case "createdAt":
      default:
        orderBy = sortDesc
          ? desc(sdkMetaAgentOptimizationJobs.createdAt)
          : sdkMetaAgentOptimizationJobs.createdAt;
    }

    // Execute query
    const jobs = await db.query.sdkMetaAgentOptimizationJobs.findMany({
      where: and(...conditions),
      orderBy: [orderBy],
      limit: limit + 1, // Fetch one extra to check for more
      offset,
    });

    // Check if there are more results
    const hasMore = jobs.length > limit;
    const results = jobs.slice(0, limit);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(sdkMetaAgentOptimizationJobs)
      .where(and(...conditions));
    const total = countResult[0]?.count || 0;

    // Fetch associated configs for completed jobs
    const configIds = results
      .filter((j) => j.configId)
      .map((j) => j.configId as string);

    let configsMap = new Map<string, { name: string; provider: string; version: number }>();
    if (configIds.length > 0) {
      const configs = await db.query.sdkMetaAgentConfigs.findMany({
        where: inArray(sdkMetaAgentConfigs.id, configIds),
        columns: {
          id: true,
          name: true,
          provider: true,
          version: true,
        },
      });
      configsMap = new Map(configs.map((c) => [c.id, { name: c.name, provider: c.provider, version: c.version }]));
    }

    // Format results
    const formattedResults = results.map((job) => {
      const scoreHistory = JSON.parse(job.scoreHistoryJson) as number[];
      const config = job.configId ? configsMap.get(job.configId) : null;

      // Calculate duration
      let durationMs: number | null = null;
      if (job.startedAt) {
        const endTime = job.completedAt || new Date();
        durationMs = endTime.getTime() - job.startedAt.getTime();
      }

      return {
        id: job.id,
        status: job.status,
        progress: {
          currentIteration: job.currentIteration,
          maxIterations: job.maxIterations,
        },
        scores: {
          final: job.currentScore,
          target: job.targetScore,
          history: scoreHistory,
        },
        timing: {
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          durationMs,
        },
        result: {
          configId: job.configId,
          configName: config?.name,
          configProvider: config?.provider,
          configVersion: config?.version,
          stopReason: job.stopReason,
          error: job.errorMessage,
        },
        context: {
          folderId: job.folderId,
          sessionId: job.sessionId,
        },
      };
    });

    return NextResponse.json({
      results: formattedResults,
      pagination: {
        offset,
        limit,
        total,
        hasMore,
      },
      filters: {
        status: params.status,
        folderId: params.folderId,
        sessionId: params.sessionId,
        startDate: params.startDate,
        endDate: params.endDate,
        minScore: params.minScore,
      },
    });
  } catch (error) {
    console.error("Failed to get optimization history:", error);
    return NextResponse.json(
      { error: "Failed to get optimization history" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/sdk/meta/history - Bulk delete optimization history
 *
 * Body:
 * - ids: Array of job IDs to delete
 * - olderThan: Delete all jobs older than this date (ISO string)
 * - status: Delete all jobs with this status (for cleanup)
 */
export const DELETE = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { ids, olderThan, status } = body as {
      ids?: string[];
      olderThan?: string;
      status?: string;
    };

    if (!ids && !olderThan && !status) {
      return NextResponse.json(
        { error: "Must specify ids, olderThan, or status for deletion" },
        { status: 400 }
      );
    }

    const conditions = [eq(sdkMetaAgentOptimizationJobs.userId, userId)];

    if (ids && ids.length > 0) {
      conditions.push(inArray(sdkMetaAgentOptimizationJobs.id, ids));
    }

    if (olderThan) {
      const olderThanDate = new Date(olderThan);
      conditions.push(lte(sdkMetaAgentOptimizationJobs.createdAt, olderThanDate));
    }

    if (status) {
      conditions.push(
        eq(
          sdkMetaAgentOptimizationJobs.status,
          status as "pending" | "running" | "completed" | "failed" | "cancelled"
        )
      );
    }

    // Don't allow deleting running jobs
    conditions.push(
      inArray(sdkMetaAgentOptimizationJobs.status, [
        "pending",
        "completed",
        "failed",
        "cancelled",
      ])
    );

    const result = await db
      .delete(sdkMetaAgentOptimizationJobs)
      .where(and(...conditions));

    return NextResponse.json({
      deleted: result.rowsAffected || 0,
      message: "Optimization history deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete optimization history:", error);
    return NextResponse.json(
      { error: "Failed to delete optimization history" },
      { status: 500 }
    );
  }
});
