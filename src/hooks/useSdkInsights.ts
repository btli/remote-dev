"use client";

/**
 * useSdkInsights - Hook for managing SDK insights.
 *
 * Provides CRUD operations for insights with:
 * - Filtering by folder, type, applicability
 * - Search functionality
 * - Confidence and verification filtering
 * - Real-time polling
 */

import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SdkInsightType =
  | "convention"
  | "pattern"
  | "anti_pattern"
  | "skill"
  | "gotcha"
  | "best_practice"
  | "dependency"
  | "performance";

export type SdkInsightApplicability =
  | "session"
  | "folder"
  | "global"
  | "language"
  | "framework";

export const SDK_INSIGHT_TYPES: SdkInsightType[] = [
  "convention",
  "pattern",
  "anti_pattern",
  "skill",
  "gotcha",
  "best_practice",
  "dependency",
  "performance",
];

export const SDK_INSIGHT_APPLICABILITIES: SdkInsightApplicability[] = [
  "session",
  "folder",
  "global",
  "language",
  "framework",
];

export interface SdkInsight {
  id: string;
  userId: string;
  folderId: string | null;
  type: SdkInsightType;
  applicability: SdkInsightApplicability;
  title: string;
  description: string;
  applicabilityContext: string | null;
  sourceNotes: string[];
  sourceSessions: string[];
  confidence: number;
  applicationCount: number;
  feedbackScore: number;
  verified: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSdkInsightInput {
  folderId?: string;
  type: SdkInsightType;
  applicability?: SdkInsightApplicability;
  title: string;
  description: string;
  applicabilityContext?: string;
  sourceNotes?: string[];
  sourceSessions?: string[];
  confidence?: number;
}

export interface UpdateSdkInsightInput {
  type?: SdkInsightType;
  applicability?: SdkInsightApplicability;
  title?: string;
  description?: string;
  applicabilityContext?: string;
  confidence?: number;
  verified?: boolean;
  active?: boolean;
}

export interface UseSdkInsightsOptions {
  folderId?: string | null;
  /** Filter by specific types */
  types?: SdkInsightType[];
  /** Filter by applicability */
  applicability?: SdkInsightApplicability;
  /** Search query */
  searchQuery?: string;
  /** Minimum confidence (0-1) */
  minConfidence?: number;
  /** Filter by verified status */
  verified?: boolean;
  /** Include inactive insights */
  includeInactive?: boolean;
  /** Polling interval in milliseconds. 0 = disabled. Default: 60000 (1 min) */
  pollInterval?: number;
  /** Limit results */
  limit?: number;
  /** Initial fetch on mount */
  autoFetch?: boolean;
}

export interface UseSdkInsightsReturn {
  /** All insights */
  insights: SdkInsight[];
  /** Insights grouped by type */
  byType: Record<SdkInsightType, SdkInsight[]>;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh insights */
  refresh: () => Promise<void>;
  /** Create a new insight */
  createInsight: (input: CreateSdkInsightInput) => Promise<SdkInsight | null>;
  /** Update an insight */
  updateInsight: (insightId: string, input: UpdateSdkInsightInput) => Promise<boolean>;
  /** Delete an insight */
  deleteInsight: (insightId: string) => Promise<boolean>;
  /** Toggle verified status */
  toggleVerified: (insightId: string) => Promise<boolean>;
  /** Toggle active status */
  toggleActive: (insightId: string) => Promise<boolean>;
  /** Counts by type */
  counts: Record<SdkInsightType, number> & { total: number; verified: number };
  /** Active filter types */
  filterTypes: SdkInsightType[];
  /** Set filter types */
  setFilterTypes: Dispatch<SetStateAction<SdkInsightType[]>>;
  /** Search query */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const parseInsight = (data: Record<string, unknown>): SdkInsight => ({
  id: data.id as string,
  userId: data.userId as string,
  folderId: data.folderId as string | null,
  type: data.type as SdkInsightType,
  applicability: data.applicability as SdkInsightApplicability,
  title: data.title as string,
  description: data.description as string,
  applicabilityContext: data.applicabilityContext as string | null,
  sourceNotes: (data.sourceNotes as string[]) ?? [],
  sourceSessions: (data.sourceSessions as string[]) ?? [],
  confidence: (data.confidence as number) ?? 0.5,
  applicationCount: (data.applicationCount as number) ?? 0,
  feedbackScore: (data.feedbackScore as number) ?? 0,
  verified: (data.verified as boolean) ?? false,
  active: (data.active as boolean) ?? true,
  createdAt: new Date(data.createdAt as string),
  updatedAt: new Date(data.updatedAt as string),
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useSdkInsights({
  folderId,
  types,
  applicability,
  searchQuery: initialSearchQuery = "",
  minConfidence = 0,
  verified,
  includeInactive = false,
  pollInterval = 60000,
  limit = 100,
  autoFetch = true,
}: UseSdkInsightsOptions = {}): UseSdkInsightsReturn {
  const [insights, setInsights] = useState<SdkInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterTypes, setFilterTypes] = useState<SdkInsightType[]>(types ?? SDK_INSIGHT_TYPES);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch insights from API
   */
  const fetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (folderId) params.set("folderId", folderId);
      if (filterTypes.length < SDK_INSIGHT_TYPES.length && filterTypes.length > 0) {
        // Only set type filter if not all types selected
        params.set("type", filterTypes[0]); // API supports single type
      }
      if (applicability) params.set("applicability", applicability);
      if (searchQuery) params.set("search", searchQuery);
      if (minConfidence > 0) params.set("minConfidence", String(minConfidence));
      if (verified !== undefined) params.set("verified", String(verified));
      if (includeInactive) params.set("active", "all");
      params.set("limit", String(limit));

      const url = `/api/sdk/insights?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const data = await response.json();
      const mapped = (data as Record<string, unknown>[]).map(parseInsight);

      // Client-side filtering by types if multiple types
      const filtered = filterTypes.length < SDK_INSIGHT_TYPES.length
        ? mapped.filter((i) => filterTypes.includes(i.type))
        : mapped;

      setInsights(filtered);
    } catch (err) {
      console.error("[useSdkInsights] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch insights");
    } finally {
      setLoading(false);
    }
  }, [folderId, filterTypes, applicability, searchQuery, minConfidence, verified, includeInactive, limit]);

  /**
   * Create a new insight
   */
  const createInsight = useCallback(async (input: CreateSdkInsightInput): Promise<SdkInsight | null> => {
    try {
      const response = await fetch("/api/sdk/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: input.folderId ?? folderId,
          type: input.type,
          applicability: input.applicability ?? "folder",
          title: input.title,
          description: input.description,
          applicabilityContext: input.applicabilityContext,
          sourceNotes: input.sourceNotes ?? [],
          sourceSessions: input.sourceSessions ?? [],
          confidence: input.confidence ?? 0.5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Create failed: ${response.statusText}`);
      }

      const data = await response.json();
      const insight = parseInsight(data);

      // Optimistically add to list
      setInsights((prev) => [insight, ...prev]);

      return insight;
    } catch (err) {
      console.error("[useSdkInsights] Create error:", err);
      setError(err instanceof Error ? err.message : "Failed to create insight");
      return null;
    }
  }, [folderId]);

  /**
   * Update an insight
   */
  const updateInsight = useCallback(async (insightId: string, input: UpdateSdkInsightInput): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sdk/insights/${insightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.statusText}`);
      }

      const data = await response.json();
      const updated = parseInsight(data);

      // Optimistically update in list
      setInsights((prev) => prev.map((i) => (i.id === insightId ? updated : i)));

      return true;
    } catch (err) {
      console.error("[useSdkInsights] Update error:", err);
      setError(err instanceof Error ? err.message : "Failed to update insight");
      return false;
    }
  }, []);

  /**
   * Delete an insight
   */
  const deleteInsight = useCallback(async (insightId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sdk/insights/${insightId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }

      // Optimistically remove from list
      setInsights((prev) => prev.filter((i) => i.id !== insightId));

      return true;
    } catch (err) {
      console.error("[useSdkInsights] Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete insight");
      return false;
    }
  }, []);

  /**
   * Toggle verified status
   */
  const toggleVerified = useCallback(async (insightId: string): Promise<boolean> => {
    const insight = insights.find((i) => i.id === insightId);
    if (!insight) return false;
    return updateInsight(insightId, { verified: !insight.verified });
  }, [insights, updateInsight]);

  /**
   * Toggle active status
   */
  const toggleActive = useCallback(async (insightId: string): Promise<boolean> => {
    const insight = insights.find((i) => i.id === insightId);
    if (!insight) return false;
    return updateInsight(insightId, { active: !insight.active });
  }, [insights, updateInsight]);

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
    {} as Record<SdkInsightType, SdkInsight[]>
  );

  // Ensure all types have arrays
  for (const type of SDK_INSIGHT_TYPES) {
    if (!byType[type]) {
      byType[type] = [];
    }
  }

  // Counts
  const counts = {
    convention: byType.convention.length,
    pattern: byType.pattern.length,
    anti_pattern: byType.anti_pattern.length,
    skill: byType.skill.length,
    gotcha: byType.gotcha.length,
    best_practice: byType.best_practice.length,
    dependency: byType.dependency.length,
    performance: byType.performance.length,
    total: insights.length,
    verified: insights.filter((i) => i.verified).length,
  };

  return {
    insights,
    byType,
    loading,
    error,
    refresh: fetchInsights,
    createInsight,
    updateInsight,
    deleteInsight,
    toggleVerified,
    toggleActive,
    counts,
    filterTypes,
    setFilterTypes,
    searchQuery,
    setSearchQuery,
  };
}
