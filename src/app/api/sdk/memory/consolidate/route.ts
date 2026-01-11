/**
 * SDK Memory Consolidation API
 *
 * Provides memory consolidation operations - promoting frequently accessed
 * short-term memories to working, and working to long-term.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries } from "@/db/schema";
import { eq, and, gte, or, isNull } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * POST /api/sdk/memory/consolidate - Consolidate memory entries
 *
 * Promotes memories between tiers based on access patterns and confidence:
 * - short_term → working: if accessCount >= 3 or confidence >= 0.7
 * - working → long_term: if accessCount >= 5 and confidence >= 0.8 and relevance >= 0.7
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { folderId } = body;

    const results = {
      shortTermToWorking: 0,
      workingToLongTerm: 0,
      errors: [] as string[],
    };

    // Build base conditions
    const baseConditions = [
      eq(sdkMemoryEntries.userId, userId),
      or(
        isNull(sdkMemoryEntries.expiresAt),
        gte(sdkMemoryEntries.expiresAt, new Date())
      )!,
    ];

    if (folderId) {
      baseConditions.push(
        or(
          eq(sdkMemoryEntries.folderId, folderId),
          isNull(sdkMemoryEntries.folderId)
        )!
      );
    }

    // 1. Promote short_term → working (accessCount >= 3 or confidence >= 0.7)
    const shortTermCandidates = await db
      .select()
      .from(sdkMemoryEntries)
      .where(
        and(
          ...baseConditions,
          eq(sdkMemoryEntries.tier, "short_term"),
          or(
            gte(sdkMemoryEntries.accessCount, 3),
            gte(sdkMemoryEntries.confidence, 0.7)
          )
        )
      );

    for (const entry of shortTermCandidates) {
      try {
        await db
          .update(sdkMemoryEntries)
          .set({
            tier: "working",
            ttlSeconds: 86400, // 24 hours
            expiresAt: new Date(Date.now() + 86400 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(sdkMemoryEntries.id, entry.id));

        results.shortTermToWorking++;
      } catch (error) {
        results.errors.push(`Failed to promote ${entry.id}: ${error}`);
      }
    }

    // 2. Promote working → long_term (accessCount >= 5, confidence >= 0.8, relevance >= 0.7)
    const workingCandidates = await db
      .select()
      .from(sdkMemoryEntries)
      .where(
        and(
          ...baseConditions,
          eq(sdkMemoryEntries.tier, "working"),
          gte(sdkMemoryEntries.accessCount, 5),
          gte(sdkMemoryEntries.confidence, 0.8),
          gte(sdkMemoryEntries.relevance, 0.7)
        )
      );

    for (const entry of workingCandidates) {
      try {
        await db
          .update(sdkMemoryEntries)
          .set({
            tier: "long_term",
            ttlSeconds: null, // No expiry for long-term
            expiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(sdkMemoryEntries.id, entry.id));

        results.workingToLongTerm++;
      } catch (error) {
        results.errors.push(`Failed to consolidate ${entry.id}: ${error}`);
      }
    }

    return NextResponse.json({
      promoted: results.shortTermToWorking + results.workingToLongTerm,
      shortTermToWorking: results.shortTermToWorking,
      workingToLongTerm: results.workingToLongTerm,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error) {
    console.error("Failed to consolidate memory:", error);
    return NextResponse.json(
      { error: "Failed to consolidate memory" },
      { status: 500 }
    );
  }
});
