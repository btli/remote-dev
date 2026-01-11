/**
 * SDK Memory Query API
 *
 * Provides advanced query operations for memory retrieval.
 * When rdv-server is available, uses semantic search with embeddings.
 * Falls back to text-based search when rdv-server is unavailable.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries } from "@/db/schema";
import { eq, and, or, gte, desc, isNull, inArray } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";
import { callRdvServer, isRdvServerAvailable } from "@/lib/rdv-proxy";

// Types for rdv-server semantic search response
interface SemanticSearchResult {
  memory: {
    id: string;
    tier: string;
    contentType: string;
    content: string;
    name?: string;
    description?: string;
    sessionId?: string;
    folderId?: string;
    taskId?: string;
    accessCount: number;
    relevance?: number;
    confidence?: number;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
  };
  score: number;
  semanticScore: number;
  tierWeight: number;
  typeWeight: number;
}

interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  query: string;
  total: number;
  semantic: boolean;
}

/**
 * POST /api/sdk/memory/query - Advanced memory query
 *
 * When rdv-server is available, proxies to semantic search endpoint.
 * Falls back to local text-based search when rdv-server is unavailable.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const {
      query,
      sessionId,
      folderId,
      taskId,
      tiers,
      contentTypes,
      minScore,
      limit = 50,
    } = body;

    // Try semantic search via rdv-server first
    if (query && typeof query === "string" && query.trim()) {
      const rdvAvailable = await isRdvServerAvailable();

      if (rdvAvailable) {
        // Use rdv-server's semantic search
        const rdvResult = await callRdvServer<SemanticSearchResponse>(
          "POST",
          "/memory/semantic-search",
          userId,
          {
            query,
            sessionId,
            folderId,
            tiers,
            contentTypes,
            minSimilarity: minScore,
            limit,
            includeExpired: false,
          }
        );

        if ("data" in rdvResult && rdvResult.data) {
          // Convert rdv-server response to our format
          const results = rdvResult.data.results.map((r) => ({
            id: r.memory.id,
            tier: r.memory.tier,
            contentType: r.memory.contentType,
            content: r.memory.content,
            name: r.memory.name,
            description: r.memory.description,
            score: r.score,
            semanticScore: r.semanticScore,
            tierWeight: r.tierWeight,
            typeWeight: r.typeWeight,
            confidence: r.memory.confidence,
            accessCount: r.memory.accessCount,
            createdAt: new Date(r.memory.createdAt),
            lastAccessedAt: new Date(r.memory.updatedAt),
            semantic: rdvResult.data.semantic,
          }));

          return NextResponse.json(results);
        }
        // Fall through to local search if rdv-server fails
        console.warn("[memory/query] rdv-server semantic search failed, falling back to local search");
      }
    }

    // Fallback: Local text-based search
    const conditions = [eq(sdkMemoryEntries.userId, userId)];

    // Exclude expired entries
    conditions.push(
      or(
        isNull(sdkMemoryEntries.expiresAt),
        gte(sdkMemoryEntries.expiresAt, new Date())
      )!
    );

    if (folderId) {
      conditions.push(
        or(
          eq(sdkMemoryEntries.folderId, folderId),
          isNull(sdkMemoryEntries.folderId)
        )!
      );
    }

    if (taskId) {
      conditions.push(eq(sdkMemoryEntries.taskId, taskId));
    }

    if (tiers && tiers.length > 0) {
      conditions.push(inArray(sdkMemoryEntries.tier, tiers));
    }

    if (contentTypes && contentTypes.length > 0) {
      conditions.push(inArray(sdkMemoryEntries.contentType, contentTypes));
    }

    if (minScore !== undefined) {
      conditions.push(gte(sdkMemoryEntries.relevance, minScore));
    }

    // Execute query
    let entries = await db
      .select()
      .from(sdkMemoryEntries)
      .where(and(...conditions))
      .orderBy(desc(sdkMemoryEntries.relevance), desc(sdkMemoryEntries.lastAccessedAt))
      .limit(limit);

    // If query string provided, do simple text matching and score adjustment
    if (query && typeof query === "string" && query.trim()) {
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

      entries = entries
        .map((entry) => {
          const contentLower = entry.content.toLowerCase();
          const nameLower = (entry.name || "").toLowerCase();

          // Simple word matching score
          let matchScore = 0;
          for (const word of queryWords) {
            if (contentLower.includes(word)) matchScore += 0.2;
            if (nameLower.includes(word)) matchScore += 0.3;
          }

          // Combine with existing relevance
          const combinedScore = Math.min(
            1.0,
            (entry.relevance || 0.5) * 0.5 + matchScore * 0.5
          );

          return {
            ...entry,
            relevance: combinedScore,
            score: combinedScore,
          };
        })
        .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
        .slice(0, limit);
    }

    // Convert to MemoryResult format
    const results = entries.map((entry) => ({
      id: entry.id,
      tier: entry.tier,
      contentType: entry.contentType,
      content: entry.content,
      name: entry.name,
      description: entry.description,
      score: entry.relevance || 0.5,
      confidence: entry.confidence,
      accessCount: entry.accessCount,
      createdAt: entry.createdAt,
      lastAccessedAt: entry.lastAccessedAt,
      metadata: entry.metadataJson ? JSON.parse(entry.metadataJson) : undefined,
      semantic: false, // Local search is not semantic
    }));

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to query memory:", error);
    return NextResponse.json(
      { error: "Failed to query memory" },
      { status: 500 }
    );
  }
});
