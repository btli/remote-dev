/**
 * SDK Memory Prune API
 *
 * Provides cleanup operations for expired memory entries.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries } from "@/db/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * POST /api/sdk/memory/prune - Prune expired memory entries
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { tier, maxAge } = body;

    // Build conditions
    const conditions = [
      eq(sdkMemoryEntries.userId, userId),
      isNotNull(sdkMemoryEntries.expiresAt),
      lt(sdkMemoryEntries.expiresAt, new Date()),
    ];

    if (tier) {
      conditions.push(eq(sdkMemoryEntries.tier, tier));
    }

    // Delete expired entries
    const result = await db
      .delete(sdkMemoryEntries)
      .where(and(...conditions))
      .returning({ id: sdkMemoryEntries.id });

    // If maxAge specified, also delete old low-relevance entries
    let additionalPruned = 0;
    if (maxAge) {
      const cutoffDate = new Date(Date.now() - maxAge * 1000);
      const oldEntries = await db
        .delete(sdkMemoryEntries)
        .where(
          and(
            eq(sdkMemoryEntries.userId, userId),
            lt(sdkMemoryEntries.lastAccessedAt, cutoffDate),
            lt(sdkMemoryEntries.relevance, 0.3)
          )
        )
        .returning({ id: sdkMemoryEntries.id });

      additionalPruned = oldEntries.length;
    }

    return NextResponse.json({
      pruned: result.length + additionalPruned,
      expiredPruned: result.length,
      stalePruned: additionalPruned,
    });
  } catch (error) {
    console.error("Failed to prune memory:", error);
    return NextResponse.json(
      { error: "Failed to prune memory" },
      { status: 500 }
    );
  }
});
