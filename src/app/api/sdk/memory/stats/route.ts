/**
 * SDK Memory Stats API
 *
 * Provides statistics about memory usage.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries } from "@/db/schema";
import { eq, and, count, sql, or, gte, isNull } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * GET /api/sdk/memory/stats - Get memory statistics
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId");

    // Build base conditions
    const conditions = [
      eq(sdkMemoryEntries.userId, userId),
      // Only count non-expired entries
      or(
        isNull(sdkMemoryEntries.expiresAt),
        gte(sdkMemoryEntries.expiresAt, new Date())
      )!,
    ];

    if (folderId) {
      conditions.push(
        or(
          eq(sdkMemoryEntries.folderId, folderId),
          isNull(sdkMemoryEntries.folderId)
        )!
      );
    }

    // Get counts by tier
    const tierCounts = await db
      .select({
        tier: sdkMemoryEntries.tier,
        count: count(),
      })
      .from(sdkMemoryEntries)
      .where(and(...conditions))
      .groupBy(sdkMemoryEntries.tier);

    // Get counts by content type
    const typeCounts = await db
      .select({
        contentType: sdkMemoryEntries.contentType,
        count: count(),
      })
      .from(sdkMemoryEntries)
      .where(and(...conditions))
      .groupBy(sdkMemoryEntries.contentType);

    // Build stats object
    const tierStats: Record<string, number> = {
      short_term: 0,
      working: 0,
      long_term: 0,
    };
    let total = 0;
    for (const row of tierCounts) {
      tierStats[row.tier] = row.count;
      total += row.count;
    }

    const typeStats: Record<string, number> = {};
    for (const row of typeCounts) {
      typeStats[row.contentType] = row.count;
    }

    // Get average scores
    const avgScores = await db
      .select({
        avgRelevance: sql<number>`avg(${sdkMemoryEntries.relevance})`,
        avgConfidence: sql<number>`avg(${sdkMemoryEntries.confidence})`,
      })
      .from(sdkMemoryEntries)
      .where(and(...conditions));

    const stats = {
      total,
      byTier: tierStats,
      byType: typeStats,
      averageRelevance: avgScores[0]?.avgRelevance ?? 0.5,
      averageConfidence: avgScores[0]?.avgConfidence ?? 0.5,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Failed to get memory stats:", error);
    return NextResponse.json(
      { error: "Failed to get memory stats" },
      { status: 500 }
    );
  }
});
