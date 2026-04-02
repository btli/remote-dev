"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type { BeadsIssue, BeadsStats } from "@/types/beads";
import { usePreferencesContext } from "./PreferencesContext";

/** Hydrate date strings from API response into Date objects */
function hydrateIssue(raw: Record<string, unknown>): BeadsIssue {
  return {
    ...(raw as unknown as BeadsIssue),
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
    closedAt: raw.closedAt ? new Date(raw.closedAt as string) : null,
    labels: (raw.labels as string[]) ?? [],
    dependencies: Array.isArray(raw.dependencies)
      ? (raw.dependencies as Record<string, unknown>[]).map((d) => ({
          ...(d as unknown as BeadsIssue["dependencies"][number]),
          createdAt: new Date(d.createdAt as string),
        }))
      : [],
    dependents: Array.isArray(raw.dependents)
      ? (raw.dependents as Record<string, unknown>[]).map((d) => ({
          ...(d as unknown as BeadsIssue["dependents"][number]),
          createdAt: new Date(d.createdAt as string),
        }))
      : [],
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

interface BeadsContextValue {
  /** All issues for the active project */
  issues: BeadsIssue[];
  /** Aggregate stats computed from the issues array */
  stats: BeadsStats | null;
  loading: boolean;
  error: string | null;
  /** The resolved project path used for queries */
  projectPath: string | null;
  /** Refresh issues from the API */
  refreshIssues: () => Promise<void>;
  /** Debounced refresh for event-driven updates (WebSocket broadcasts). */
  debouncedRefresh: () => void;
}

const BeadsContext = createContext<BeadsContextValue | null>(null);

export function useBeadsContext() {
  const context = useContext(BeadsContext);
  if (!context) {
    throw new Error("useBeadsContext must be used within a BeadsProvider");
  }
  return context;
}

interface BeadsProviderProps {
  children: ReactNode;
}

export function BeadsProvider({ children }: BeadsProviderProps) {
  const [issues, setIssues] = useState<BeadsIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentPreferences } = usePreferencesContext();
  const projectPath = currentPreferences.defaultWorkingDirectory || null;

  const abortRef = useRef<AbortController | null>(null);

  // Compute stats client-side from issues array
  const computedStats = useMemo(() => {
    if (issues.length === 0) return null;
    const stats = { total: issues.length, open: 0, inProgress: 0, closed: 0, blocked: 0, ready: 0 };
    for (const issue of issues) {
      if (issue.status === "closed") stats.closed++;
      else if (issue.status === "in_progress") stats.inProgress++;
      else if (issue.status === "open" && issue.dependencies.length === 0) { stats.open++; stats.ready++; }
      else stats.open++;
      if (issue.dependencies.length > 0 && issue.status !== "closed") stats.blocked++;
    }
    return stats;
  }, [issues]);

  const refreshIssues = useCallback(async () => {
    abortRef.current?.abort();

    if (!projectPath) {
      setIssues([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const encodedPath = encodeURIComponent(projectPath);

      const issuesRes = await fetch(`/api/beads?projectPath=${encodedPath}`, {
        signal: controller.signal,
      });

      if (!issuesRes.ok) {
        throw new Error("Failed to fetch beads issues");
      }

      const issuesData = await issuesRes.json();
      setIssues(
        Array.isArray(issuesData) ? issuesData.map(hydrateIssue) : []
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      // Only clear loading if this controller wasn't aborted by a newer request
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [projectPath]);

  // Debounced refresh for coalescing rapid WebSocket events
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      refreshIssues();
    }, 150);
  }, [refreshIssues]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Reload when project path changes
  useEffect(() => {
    refreshIssues();
  }, [refreshIssues]);

  // Refresh when page becomes visible again (e.g. after sleep, tab switch)
  const refreshRef = useRef(refreshIssues);
  refreshRef.current = refreshIssues;

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (!document.hidden) {
        refreshRef.current();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const value = useMemo(
    () => ({
      issues,
      stats: computedStats,
      loading,
      error,
      projectPath,
      refreshIssues,
      debouncedRefresh,
    }),
    [issues, computedStats, loading, error, projectPath, refreshIssues, debouncedRefresh]
  );

  return (
    <BeadsContext.Provider value={value}>{children}</BeadsContext.Provider>
  );
}
