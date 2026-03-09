import { useState, useEffect, useCallback, useRef } from "react";

interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  pr: { number: number; state: string; url: string } | null;
}

interface UseSessionGitStatusResult {
  gitStatus: GitStatus | null;
  loading: boolean;
  refresh: () => void;
}

// Simple in-memory cache with TTL
const cache = new Map<string, { data: GitStatus; fetchedAt: number }>();
const TTL_MS = 60_000; // 60 seconds
const MAX_CACHE_ENTRIES = 200;

/** Evict expired entries when cache grows beyond limit */
function evictExpiredEntries(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.fetchedAt > TTL_MS) cache.delete(key);
  }
}

export function useSessionGitStatus(
  sessionId: string | null,
  enabled = true
): UseSessionGitStatusResult {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(() => {
    if (!sessionId) return null;
    const cached = cache.get(sessionId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.data;
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(
    async (id: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const response = await fetch(`/api/sessions/${id}/git-status`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) {
          setLoading(false);
          return;
        }

        const data: GitStatus = await response.json();
        cache.set(id, { data, fetchedAt: Date.now() });
        evictExpiredEntries();
        if (!controller.signal.aborted) {
          setGitStatus(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        // Silently fail - git status is non-critical
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    []
  );

  const refresh = useCallback(() => {
    if (sessionId) {
      cache.delete(sessionId);
      fetchStatus(sessionId);
    }
  }, [sessionId, fetchStatus]);

  useEffect(() => {
    if (!sessionId || !enabled) {
      setGitStatus(null);
      return;
    }

    // Check cache first
    const cached = cache.get(sessionId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      setGitStatus(cached.data);
      return;
    }

    // Stagger requests by adding random 0-2s delay on mount
    const delay = Math.random() * 2000;
    const timer = setTimeout(() => {
      fetchStatus(sessionId);
    }, delay);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [sessionId, enabled, fetchStatus]);

  return { gitStatus, loading, refresh };
}
