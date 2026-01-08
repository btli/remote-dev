/**
 * GET /api/orchestrators/health
 *
 * Get health metrics for all orchestrators including:
 * - Active monitoring status
 * - Failure tracking (consecutive failures, total failures, timestamps)
 * - Snapshot store size
 * Rate limit: 30 requests per minute
 */
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { checkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import {
  getAllFailureMetrics,
  isMonitoringActive,
} from "@/services/monitoring-service";
import { db } from "@/db";
import { orchestratorSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit: 30 requests per minute
    const rateLimit = checkRateLimit(`orchestrators:health:${userId}`, {
      limit: 30,
      windowMs: 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        {
          status: 429,
          headers: createRateLimitHeaders(rateLimit),
        }
      );
    }

    // Get all orchestrators for this user
    const orchestrators = await db
      .select()
      .from(orchestratorSessions)
      .where(eq(orchestratorSessions.userId, userId));

    // Get all failure metrics
    const allFailureMetrics = getAllFailureMetrics();

    // Build health metrics for each orchestrator
    const healthMetrics = orchestrators.map((orchestrator) => {
      const isActive = isMonitoringActive(orchestrator.id);
      const failureMetrics = allFailureMetrics.get(orchestrator.id);

      return {
        orchestratorId: orchestrator.id,
        type: orchestrator.type,
        status: orchestrator.status,
        monitoringActive: isActive,
        health: {
          consecutiveFailures: failureMetrics?.consecutiveFailures ?? 0,
          totalFailures: failureMetrics?.totalFailures ?? 0,
          lastFailureAt: failureMetrics?.lastFailureAt?.toISOString() ?? null,
          lastSuccessAt: failureMetrics?.lastSuccessAt?.toISOString() ?? null,
          isHealthy:
            !failureMetrics || failureMetrics.consecutiveFailures < 3,
        },
        config: {
          monitoringInterval: orchestrator.monitoringInterval,
          stallThreshold: orchestrator.stallThreshold,
          autoIntervention: orchestrator.autoIntervention,
        },
        timestamps: {
          lastActivityAt: orchestrator.lastActivityAt.toISOString(),
          createdAt: orchestrator.createdAt.toISOString(),
          updatedAt: orchestrator.updatedAt.toISOString(),
        },
      };
    });

    // Calculate aggregate health stats
    const totalOrchestrators = orchestrators.length;
    const activeOrchestrators = healthMetrics.filter(
      (m) => m.monitoringActive
    ).length;
    const healthyOrchestrators = healthMetrics.filter(
      (m) => m.health.isHealthy
    ).length;
    const failingOrchestrators = healthMetrics.filter(
      (m) => m.health.consecutiveFailures > 0
    ).length;

    return NextResponse.json(
      {
        summary: {
          totalOrchestrators,
          activeOrchestrators,
          healthyOrchestrators,
          failingOrchestrators,
          overallHealth:
            totalOrchestrators > 0
              ? Math.round((healthyOrchestrators / totalOrchestrators) * 100)
              : 100,
        },
        orchestrators: healthMetrics,
      },
      { headers: createRateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    console.error("[API] Failed to get orchestrator health metrics:", error);
    return NextResponse.json(
      {
        error: "Failed to get health metrics",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
