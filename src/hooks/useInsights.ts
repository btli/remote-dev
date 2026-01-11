"use client";

/**
 * useInsights - Hook for querying insight-type memories.
 *
 * Focuses on memories with content types:
 * - insight:convention, insight:pattern, insight:gotcha
 * - insight:skill, insight:tool
 *
 * Provides filtering, actions, and real-time updates.
 */

import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InsightType =
  | "convention"
  | "pattern"
  | "gotcha"
  | "skill"
  | "tool";

export const INSIGHT_TYPES: InsightType[] = [
  "convention",
  "pattern",
  "gotcha",
  "skill",
  "tool",
];

export interface Insight {
  id: string;
  type: InsightType;
  content: string;
  name: string | null;
  description: string | null;
  confidence: number;
  relevance: number;
  accessCount: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  folderId?: string | null;
  sessionId?: string | null;
}

export interface UseInsightsOptions {
  folderId?: string | null;
  /** Filter by specific types */
  types?: InsightType[];
  /** Polling interval in milliseconds. 0 = disabled. Default: 60000 (1 min) */
  pollInterval?: number;
  /** Minimum confidence (0-1) */
  minConfidence?: number;
  /** Limit results */
  limit?: number;
  /** Initial fetch on mount */
  autoFetch?: boolean;
}

export interface UseInsightsReturn {
  /** All insights */
  insights: Insight[];
  /** Insights grouped by type */
  byType: Record<InsightType, Insight[]>;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh insights */
  refresh: () => Promise<void>;
  /** Delete an insight */
  deleteInsight: (insightId: string) => Promise<void>;
  /** Update insight confidence */
  updateConfidence: (insightId: string, confidence: number) => Promise<void>;
  /** Counts by type */
  counts: Record<InsightType, number> & { total: number };
  /** Active filter types */
  filterTypes: InsightType[];
  /** Set filter types */
  setFilterTypes: Dispatch<SetStateAction<InsightType[]>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useInsights({
  folderId,
  types,
  pollInterval = 60000,
  minConfidence = 0.3,
  limit = 50,
  autoFetch = true,
}: UseInsightsOptions = {}): UseInsightsReturn {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTypes, setFilterTypes] = useState<InsightType[]>(types ?? INSIGHT_TYPES);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch insights from API
   */
  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Build query params
      const params = new URLSearchParams();

      // Filter for insight content types
      const contentTypes = filterTypes.map((t) => `insight:${t}`);
      params.set("contentTypes", JSON.stringify(contentTypes));

      if (folderId) params.set("folderId", folderId);
      if (minConfidence > 0) params.set("minConfidence", String(minConfidence));
      params.set("limit", String(limit));

      // Use POST query endpoint for content type filtering
      const response = await fetch("/api/sdk/memory/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId,
          contentTypes,
          minScore: minConfidence,
          limit,
        }),
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const entries = await response.json();

      // Map to Insight type
      const mapped: Insight[] = entries.map((e: Record<string, unknown>) => {
        const contentType = e.contentType as string;
        const type = contentType.replace("insight:", "") as InsightType;
        return {
          id: e.id as string,
          type,
          content: e.content as string,
          name: e.name as string | null,
          description: e.description as string | null,
          confidence: (e.confidence as number) ?? 0.5,
          relevance: (e.score as number) ?? (e.relevance as number) ?? 0.5,
          accessCount: (e.accessCount as number) ?? 0,
          createdAt: new Date(e.createdAt as string),
          metadata: e.metadata as Record<string, unknown> | undefined,
          folderId: e.folderId as string | null,
          sessionId: e.sessionId as string | null,
        };
      });

      setInsights(mapped);
    } catch (err) {
      console.error("[useInsights] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch insights");
    } finally {
      setLoading(false);
    }
  }, [folderId, filterTypes, minConfidence, limit]);

  /**
   * Delete an insight
   */
  const deleteInsight = useCallback(async (insightId: string) => {
    try {
      const response = await fetch(`/api/sdk/memory/${insightId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }

      await fetchInsights();
    } catch (err) {
      console.error("[useInsights] Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete insight");
    }
  }, [fetchInsights]);

  /**
   * Update insight confidence (useful for reinforcement)
   */
  const updateConfidence = useCallback(async (insightId: string, confidence: number) => {
    try {
      const response = await fetch(`/api/sdk/memory/${insightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidence }),
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.statusText}`);
      }

      await fetchInsights();
    } catch (err) {
      console.error("[useInsights] Update error:", err);
      setError(err instanceof Error ? err.message : "Failed to update insight");
    }
  }, [fetchInsights]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchInsights();
    }
  }, [autoFetch, fetchInsights]);

  // Polling
  useEffect(() => {
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchInsights, pollInterval);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [pollInterval, fetchInsights]);

  // Group by type
  const byType = insights.reduce(
    (acc, insight) => {
      if (!acc[insight.type]) {
        acc[insight.type] = [];
      }
      acc[insight.type].push(insight);
      return acc;
    },
    {} as Record<InsightType, Insight[]>
  );

  // Ensure all types have arrays
  for (const type of INSIGHT_TYPES) {
    if (!byType[type]) {
      byType[type] = [];
    }
  }

  // Counts
  const counts = {
    convention: byType.convention.length,
    pattern: byType.pattern.length,
    gotcha: byType.gotcha.length,
    skill: byType.skill.length,
    tool: byType.tool.length,
    total: insights.length,
  };

  return {
    insights,
    byType,
    loading,
    error,
    refresh: fetchInsights,
    deleteInsight,
    updateConfidence,
    counts,
    filterTypes,
    setFilterTypes,
  };
}
