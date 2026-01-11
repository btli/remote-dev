/**
 * SDK Memory API Routes
 *
 * Provides CRUD operations for the hierarchical memory system.
 * Maps SDK memory operations to database operations on sdk_memory_entry table.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries, type MemoryTierType, type MemoryContentType } from "@/db/schema";
import { eq, and, or, gte, desc, isNull } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";
import { createHash } from "crypto";

// Helper to compute content hash
function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Helper to compute expiry time
function computeExpiresAt(ttlSeconds: number | null): Date | null {
  if (!ttlSeconds) return null;
  return new Date(Date.now() + ttlSeconds * 1000);
}

/**
 * POST /api/sdk/memory - Store a new memory entry
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const {
      sessionId,
      folderId,
      tier,
      contentType,
      content,
      name,
      description,
      taskId,
      priority,
      confidence,
      relevance,
      ttl,
      metadata,
    } = body;

    // Validate required fields
    if (!tier || !contentType || !content) {
      return NextResponse.json(
        { error: "tier, contentType, and content are required" },
        { status: 400 }
      );
    }

    // Check for duplicate content
    const contentHash = computeContentHash(content);
    const existing = await db
      .select()
      .from(sdkMemoryEntries)
      .where(
        and(
          eq(sdkMemoryEntries.userId, userId),
          eq(sdkMemoryEntries.contentHash, contentHash),
          eq(sdkMemoryEntries.tier, tier as MemoryTierType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update access count and return existing
      const [updated] = await db
        .update(sdkMemoryEntries)
        .set({
          accessCount: existing[0].accessCount + 1,
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sdkMemoryEntries.id, existing[0].id))
        .returning();

      return NextResponse.json(updated);
    }

    // Determine TTL based on tier
    const effectiveTtl =
      ttl ?? (tier === "short_term" ? 300 : tier === "working" ? 86400 : null);

    const [entry] = await db
      .insert(sdkMemoryEntries)
      .values({
        userId,
        sessionId: sessionId || null,
        folderId: folderId || null,
        tier: tier as MemoryTierType,
        contentType: contentType as MemoryContentType,
        content,
        name: name || null,
        description: description || null,
        contentHash,
        taskId: taskId || null,
        priority: priority ?? 0,
        confidence: confidence ?? 0.5,
        relevance: relevance ?? 0.5,
        ttlSeconds: effectiveTtl,
        expiresAt: computeExpiresAt(effectiveTtl),
        metadataJson: metadata ? JSON.stringify(metadata) : null,
      })
      .returning();

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error("Failed to store memory:", error);
    return NextResponse.json(
      { error: "Failed to store memory" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/memory - Query memory entries
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const tier = url.searchParams.get("tier") as MemoryTierType | null;
    const contentType = url.searchParams.get("contentType") as MemoryContentType | null;
    const folderId = url.searchParams.get("folderId");
    const sessionId = url.searchParams.get("sessionId");
    const taskId = url.searchParams.get("taskId");
    const minRelevance = url.searchParams.get("minRelevance");
    const minConfidence = url.searchParams.get("minConfidence");
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    // Build query conditions
    const conditions = [eq(sdkMemoryEntries.userId, userId)];

    // Exclude expired entries
    conditions.push(
      or(
        isNull(sdkMemoryEntries.expiresAt),
        gte(sdkMemoryEntries.expiresAt, new Date())
      )!
    );

    if (tier) {
      conditions.push(eq(sdkMemoryEntries.tier, tier));
    }
    if (contentType) {
      conditions.push(eq(sdkMemoryEntries.contentType, contentType));
    }
    if (folderId) {
      conditions.push(eq(sdkMemoryEntries.folderId, folderId));
    }
    if (sessionId) {
      conditions.push(eq(sdkMemoryEntries.sessionId, sessionId));
    }
    if (taskId) {
      conditions.push(eq(sdkMemoryEntries.taskId, taskId));
    }
    if (minRelevance) {
      conditions.push(gte(sdkMemoryEntries.relevance, parseFloat(minRelevance)));
    }
    if (minConfidence) {
      conditions.push(gte(sdkMemoryEntries.confidence, parseFloat(minConfidence)));
    }

    const entries = await db
      .select()
      .from(sdkMemoryEntries)
      .where(and(...conditions))
      .orderBy(desc(sdkMemoryEntries.relevance), desc(sdkMemoryEntries.lastAccessedAt))
      .limit(limit);

    return NextResponse.json(entries);
  } catch (error) {
    console.error("Failed to query memory:", error);
    return NextResponse.json(
      { error: "Failed to query memory" },
      { status: 500 }
    );
  }
});
