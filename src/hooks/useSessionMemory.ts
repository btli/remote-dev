"use client";

/**
 * useSessionMemory - Hook for session-scoped memory queries and actions.
 *
 * Provides:
 * - Fetch memories relevant to active session (session + folder scope)
 * - Real-time updates via polling
 * - Quick actions: pin to working memory, dismiss, link to note
 * - Tier-based organization
 */

import { useState, useCallback, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryTier = "short_term" | "working" | "long_term";

export type MemoryContentType =
  | "note:todo"
  | "note:reminder"
  | "note:question"
  | "note:observation"
  | "note:warning"
  | "note:decision"
  | "insight:convention"
  | "insight:pattern"
  | "insight:gotcha"
  | "insight:skill"
  | "insight:tool"
  // Plain types (CLI default types without prefix)
  | "observation"
  | "convention"
  | "pattern"
  | "gotcha"
  | "skill"
  | "tool"
  | "command"
  | "context"
  | "task_context"
  | "error"
  | "discovery"
  | "reference"
  | "project";

export interface MemoryEntry {
  id: string;
  userId: string;
  sessionId: string | null;
  folderId: string | null;
  tier: MemoryTier;
  contentType: MemoryContentType;
  name: string | null;
  description: string | null;
  content: string;
  taskId: string | null;
  priority: number;
  confidence: number;
  relevance: number;
  accessCount: number;
  ttlSeconds: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastAccessedAt: Date | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryQueryResult extends MemoryEntry {
  score?: number;
  semanticScore?: number;
  semantic?: boolean;
}

export interface UseSessionMemoryOptions {
  sessionId: string | null;
  folderId: string | null;
  /** Polling interval in milliseconds. 0 = disabled. Default: 30000 (30s) */
  pollInterval?: number;
  /** Query string for search */
  query?: string;
  /** Minimum relevance score (0-1) */
  minRelevance?: number;
  /** Limit results */
  limit?: number;
  /** Initial fetch on mount */
  autoFetch?: boolean;
}

export interface UpdateMemoryParams {
  tier?: MemoryTier;
  content?: string;
  name?: string;
  confidence?: number;
  relevance?: number;
  priority?: number;
}

export interface UseSessionMemoryReturn {
  /** Current memory entries grouped by tier */
  memories: {
    short_term: MemoryQueryResult[];
    working: MemoryQueryResult[];
    long_term: MemoryQueryResult[];
  };
  /** All memories flat */
  allMemories: MemoryQueryResult[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh memories */
  refresh: () => Promise<void>;
  /** Pin memory to working tier */
  pinToWorking: (memoryId: string) => Promise<void>;
  /** Dismiss memory (reduce relevance) */
  dismiss: (memoryId: string) => Promise<void>;
  /** Delete memory */
  deleteMemory: (memoryId: string) => Promise<void>;
  /** Promote memory to long-term */
  promoteToLongTerm: (memoryId: string, name: string) => Promise<void>;
  /** Store new memory */
  storeMemory: (entry: StoreMemoryParams) => Promise<MemoryEntry | null>;
  /** Update memory content or metadata */
  updateMemory: (memoryId: string, params: UpdateMemoryParams) => Promise<MemoryEntry | null>;
  /** Total count by tier */
  counts: {
    short_term: number;
    working: number;
    long_term: number;
    total: number;
  };
}

export interface StoreMemoryParams {
  tier: MemoryTier;
  contentType: MemoryContentType;
  content: string;
  name?: string;
  description?: string;
  taskId?: string;
  priority?: number;
  confidence?: number;
  relevance?: number;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useSessionMemory({
  sessionId,
  folderId,
  pollInterval = 30000,
  query,
  minRelevance = 0.3,
  limit = 100,
  autoFetch = true,
}: UseSessionMemoryOptions): UseSessionMemoryReturn {
  const [memories, setMemories] = useState<{
    short_term: MemoryQueryResult[];
    working: MemoryQueryResult[];
    long_term: MemoryQueryResult[];
  }>({
    short_term: [],
    working: [],
    long_term: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch memories from API
   */
  const fetchMemories = useCallback(async () => {
    if (!sessionId && !folderId) {
      setMemories({ short_term: [], working: [], long_term: [] });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use query endpoint if search query provided, otherwise basic GET
      let entries: MemoryQueryResult[];

      if (query && query.trim()) {
        // Advanced query with optional semantic search
        // Use folderId as primary scope, sessionId only as fallback
        const scopeParams: { sessionId?: string; folderId?: string } = {};
        if (folderId) {
          scopeParams.folderId = folderId;
        } else if (sessionId) {
          scopeParams.sessionId = sessionId;
        }
        const response = await fetch("/api/sdk/memory/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            ...scopeParams,
            minScore: minRelevance,
            limit,
          }),
        });

        if (!response.ok) {
          throw new Error(`Query failed: ${response.statusText}`);
        }

        // rdv-server returns { results: [...], query, total, semantic }
        const data = await response.json();
        entries = Array.isArray(data) ? data : (data.results ?? []).map((r: { memory: MemoryQueryResult; score: number; semanticScore: number }) => ({
          ...r.memory,
          score: r.score,
          semanticScore: r.semanticScore,
          semantic: true,
        }));
      } else {
        // Basic query - fetch by folder or session scope
        // Use folderId as primary scope (folder-level memories are visible to all sessions)
        // Only use sessionId as fallback if no folderId is available
        const params = new URLSearchParams();
        if (folderId) {
          // Folder scope - shows all memories for the folder (including session-less ones)
          params.set("folderId", folderId);
        } else if (sessionId) {
          // Session-only scope (fallback when no folder)
          params.set("sessionId", sessionId);
        }
        if (minRelevance > 0) params.set("minRelevance", String(minRelevance));
        params.set("limit", String(limit));

        const url = `/api/sdk/memory?${params.toString()}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.statusText}`);
        }

        // rdv-server returns { memories: [...], total }
        const data = await response.json();
        entries = Array.isArray(data) ? data : (data.memories ?? []);
      }

      // Group by tier
      const grouped = {
        short_term: entries.filter((e) => e.tier === "short_term"),
        working: entries.filter((e) => e.tier === "working"),
        long_term: entries.filter((e) => e.tier === "long_term"),
      };

      setMemories(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch memories");
    } finally {
      setLoading(false);
    }
  }, [sessionId, folderId, query, minRelevance, limit]);

  /**
   * Pin memory to working tier (updates tier and extends TTL)
   */
  const pinToWorking = useCallback(async (memoryId: string) => {
    try {
      const response = await fetch(`/api/sdk/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: "working",
          ttlSeconds: 86400, // 24 hours
          priority: 5, // Bump priority
        }),
      });

      if (!response.ok) {
        throw new Error(`Pin failed: ${response.statusText}`);
      }

      // Refresh to show updated state
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pin memory");
    }
  }, [fetchMemories]);

  /**
   * Dismiss memory (reduce relevance to hide from view)
   */
  const dismiss = useCallback(async (memoryId: string) => {
    try {
      const response = await fetch(`/api/sdk/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relevance: 0.1, // Low relevance to hide
        }),
      });

      if (!response.ok) {
        throw new Error(`Dismiss failed: ${response.statusText}`);
      }

      // Refresh to show updated state
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss memory");
    }
  }, [fetchMemories]);

  /**
   * Delete memory permanently
   */
  const deleteMemory = useCallback(async (memoryId: string) => {
    try {
      const response = await fetch(`/api/sdk/memory/${memoryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }

      // Refresh to show updated state
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    }
  }, [fetchMemories]);

  /**
   * Promote memory to long-term with a name
   */
  const promoteToLongTerm = useCallback(async (memoryId: string, name: string) => {
    try {
      const response = await fetch(`/api/sdk/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: "long_term",
          name,
          ttlSeconds: null, // No expiry
          relevance: 0.8, // High relevance
        }),
      });

      if (!response.ok) {
        throw new Error(`Promote failed: ${response.statusText}`);
      }

      // Refresh to show updated state
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote memory");
    }
  }, [fetchMemories]);

  /**
   * Store new memory
   */
  const storeMemory = useCallback(async (params: StoreMemoryParams): Promise<MemoryEntry | null> => {
    try {
      const response = await fetch("/api/sdk/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          sessionId,
          folderId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Store failed: ${response.statusText}`);
      }

      const entry = await response.json();

      // Refresh to show new entry
      await fetchMemories();

      return entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to store memory");
      return null;
    }
  }, [sessionId, folderId, fetchMemories]);

  /**
   * Update memory content or metadata
   */
  const updateMemory = useCallback(async (memoryId: string, params: UpdateMemoryParams): Promise<MemoryEntry | null> => {
    try {
      const response = await fetch(`/api/sdk/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.statusText}`);
      }

      const entry = await response.json();

      // Refresh to show updated entry
      await fetchMemories();

      return entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update memory");
      return null;
    }
  }, [fetchMemories]);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchMemories();
    }
  }, [autoFetch, fetchMemories]);

  // Polling - always return cleanup to handle condition changes
  useEffect(() => {
    if (pollInterval > 0 && (sessionId || folderId)) {
      intervalRef.current = setInterval(fetchMemories, pollInterval);
    }
    // Always return cleanup to clear any existing interval when deps change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollInterval, sessionId, folderId, fetchMemories]);

  // SSE subscription for real-time updates
  // When CLI/SDK creates memories, they send lightweight notification to server
  // which broadcasts via SSE - this is more efficient than polling
  useEffect(() => {
    if (!sessionId && !folderId) return;

    const eventSource = new EventSource("/api/events/memory");

    eventSource.addEventListener("memory", (event) => {
      try {
        JSON.parse(event.data);
        // Refresh on any memory event (created, updated, deleted, promoted)
        fetchMemories();
      } catch {
        // Ignore parse errors - EventSource will continue
      }
    });

    eventSource.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId, folderId, fetchMemories]);

  // Compute flat list and counts
  const allMemories = [
    ...memories.short_term,
    ...memories.working,
    ...memories.long_term,
  ];

  const counts = {
    short_term: memories.short_term.length,
    working: memories.working.length,
    long_term: memories.long_term.length,
    total: allMemories.length,
  };

  return {
    memories,
    allMemories,
    loading,
    error,
    refresh: fetchMemories,
    pinToWorking,
    dismiss,
    deleteMemory,
    promoteToLongTerm,
    storeMemory,
    updateMemory,
    counts,
  };
}
