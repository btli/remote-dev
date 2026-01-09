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
  isStallCheckingActive,
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

    // Build health metrics for each orchestrator
    // Event-driven monitoring is simpler - health is based on activity timestamps
    const healthMetrics = orchestrators.map((orchestrator) => {
      const isActive = isStallCheckingActive(orchestrator.id);

      // Calculate time since last activity
      const lastActivityMs = orchestrator.lastActivityAt.getTime();
      const minutesSinceActivity = Math.floor((Date.now() - lastActivityMs) / 60000);
      const stallThresholdMinutes = Math.floor(orchestrator.stallThreshold / 60);

      // Orchestrator is healthy if it received activity within 2x stall threshold
      const isHealthy = minutesSinceActivity < stallThresholdMinutes * 2;

      return {
        orchestratorId: orchestrator.id,
        type: orchestrator.type,
        status: orchestrator.status,
        stallCheckingActive: isActive,
        health: {
          minutesSinceActivity,
          stallThresholdMinutes,
          isHealthy,
          receivingHeartbeats: minutesSinceActivity < stallThresholdMinutes,
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
      (m) => m.stallCheckingActive
    ).length;
    const healthyOrchestrators = healthMetrics.filter(
      (m) => m.health.isHealthy
    ).length;
    const receivingHeartbeats = healthMetrics.filter(
      (m) => m.health.receivingHeartbeats
    ).length;

    return NextResponse.json(
      {
        summary: {
          totalOrchestrators,
          activeOrchestrators,
          healthyOrchestrators,
          receivingHeartbeats,
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
