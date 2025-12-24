"use client";

/**
 * GitHubStatsContext - Global state for GitHub repository stats
 * Provides background polling, change tracking, and repository data
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  GITHUB_STATS_TTL_MINUTES,
  type EnrichedRepository,
  type RefreshResult,
} from "@/types/github-stats";

// =============================================================================
// State Types
// =============================================================================

interface GitHubStatsState {
  repositories: EnrichedRepository[];
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefresh: Date | null;
  hasChanges: boolean;
  totalNewPRs: number;
  totalNewIssues: number;
  error: string | null;
}

type GitHubStatsAction =
  | { type: "SET_REPOSITORIES"; repositories: EnrichedRepository[] }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_REFRESHING"; isRefreshing: boolean }
  | { type: "SET_LAST_REFRESH"; lastRefresh: Date }
  | {
      type: "SET_CHANGES";
      hasChanges: boolean;
      totalNewPRs: number;
      totalNewIssues: number;
    }
  | { type: "CLEAR_CHANGES" }
  | { type: "SET_ERROR"; error: string | null }
  | {
      type: "REFRESH_COMPLETE";
      repositories: EnrichedRepository[];
      result: RefreshResult;
      hasChanges: boolean;
      totalNewPRs: number;
      totalNewIssues: number;
    };

// =============================================================================
// Initial State & Reducer
// =============================================================================

const initialState: GitHubStatsState = {
  repositories: [],
  isLoading: false,
  isRefreshing: false,
  lastRefresh: null,
  hasChanges: false,
  totalNewPRs: 0,
  totalNewIssues: 0,
  error: null,
};

function reducer(
  state: GitHubStatsState,
  action: GitHubStatsAction
): GitHubStatsState {
  switch (action.type) {
    case "SET_REPOSITORIES":
      return { ...state, repositories: action.repositories };

    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };

    case "SET_REFRESHING":
      return { ...state, isRefreshing: action.isRefreshing };

    case "SET_LAST_REFRESH":
      return { ...state, lastRefresh: action.lastRefresh };

    case "SET_CHANGES":
      return {
        ...state,
        hasChanges: action.hasChanges,
        totalNewPRs: action.totalNewPRs,
        totalNewIssues: action.totalNewIssues,
      };

    case "CLEAR_CHANGES":
      return {
        ...state,
        hasChanges: false,
        totalNewPRs: 0,
        totalNewIssues: 0,
      };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "REFRESH_COMPLETE":
      return {
        ...state,
        repositories: action.repositories,
        isRefreshing: false,
        lastRefresh: new Date(),
        hasChanges: action.hasChanges,
        totalNewPRs: action.totalNewPRs,
        totalNewIssues: action.totalNewIssues,
        error: null,
      };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface GitHubStatsContextValue {
  state: GitHubStatsState;
  refreshStats: () => Promise<void>;
  fetchStats: () => Promise<void>;
  markChangesSeen: (repositoryId?: string) => Promise<void>;
  getRepositoryById: (id: string) => EnrichedRepository | undefined;
}

const GitHubStatsContext = createContext<GitHubStatsContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface GitHubStatsProviderProps {
  children: React.ReactNode;
  refreshIntervalMinutes?: number;
  isGitHubConnected?: boolean;
}

export function GitHubStatsProvider({
  children,
  refreshIntervalMinutes = GITHUB_STATS_TTL_MINUTES,
  isGitHubConnected = false,
}: GitHubStatsProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasTriggeredStaleRefresh = useRef(false);

  // Refresh stats from GitHub (triggers API fetch) - defined first for use in fetchStats
  const refreshStats = useCallback(async () => {
    if (!isGitHubConnected) return;

    dispatch({ type: "SET_REFRESHING", isRefreshing: true });

    try {
      const response = await fetch("/api/github/stats", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh stats: ${response.status}`);
      }

      const data = await response.json();
      dispatch({
        type: "REFRESH_COMPLETE",
        repositories: data.repositories,
        result: data.result,
        hasChanges: data.changes.hasChanges,
        totalNewPRs: data.changes.totalPRs,
        totalNewIssues: data.changes.totalIssues,
      });
      dispatch({ type: "SET_LAST_REFRESH", lastRefresh: new Date() });
    } catch (error) {
      const err = error as Error;
      dispatch({ type: "SET_ERROR", error: err.message });
    } finally {
      dispatch({ type: "SET_REFRESHING", isRefreshing: false });
    }
  }, [isGitHubConnected]);

  // Fetch stats without refreshing from GitHub
  const fetchStats = useCallback(async () => {
    if (!isGitHubConnected) return;

    dispatch({ type: "SET_LOADING", isLoading: true });

    try {
      const response = await fetch("/api/github/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch stats");
      }

      const data = await response.json();
      dispatch({ type: "SET_REPOSITORIES", repositories: data.repositories });
      dispatch({
        type: "SET_CHANGES",
        hasChanges: data.changes.hasChanges,
        totalNewPRs: data.changes.totalPRs,
        totalNewIssues: data.changes.totalIssues,
      });

      // Auto-trigger refresh if we have stale/missing data (once per session)
      if (data.hasStaleData && !hasTriggeredStaleRefresh.current) {
        hasTriggeredStaleRefresh.current = true;
        refreshStats();
      }
    } catch (error) {
      const err = error as Error;
      dispatch({ type: "SET_ERROR", error: err.message });
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, [isGitHubConnected, refreshStats]);

  // Mark changes as seen
  const markChangesSeen = useCallback(async (repositoryId?: string) => {
    try {
      await fetch("/api/github/stats/mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId }),
      });

      if (repositoryId) {
        // Update specific repo in state
        dispatch({
          type: "SET_REPOSITORIES",
          repositories: state.repositories.map((r) =>
            r.id === repositoryId
              ? { ...r, hasChanges: false, changeCount: 0 }
              : r
          ),
        });
      } else {
        dispatch({ type: "CLEAR_CHANGES" });
        dispatch({
          type: "SET_REPOSITORIES",
          repositories: state.repositories.map((r) => ({
            ...r,
            hasChanges: false,
            changeCount: 0,
          })),
        });
      }
    } catch (error) {
      console.error("Failed to mark changes as seen:", error);
    }
  }, [state.repositories]);

  // Get repository by ID
  const getRepositoryById = useCallback(
    (id: string) => state.repositories.find((r) => r.id === id),
    [state.repositories]
  );

  // Initial fetch on mount
  useEffect(() => {
    if (isGitHubConnected) {
      fetchStats();
    }
  }, [isGitHubConnected, fetchStats]);

  // Set up background polling
  useEffect(() => {
    if (!isGitHubConnected || refreshIntervalMinutes <= 0) {
      return;
    }

    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up new interval
    intervalRef.current = setInterval(
      () => {
        refreshStats();
      },
      refreshIntervalMinutes * 60 * 1000
    );

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isGitHubConnected, refreshIntervalMinutes, refreshStats]);

  const contextValue = useMemo(
    () => ({
      state,
      refreshStats,
      fetchStats,
      markChangesSeen,
      getRepositoryById,
    }),
    [state, refreshStats, fetchStats, markChangesSeen, getRepositoryById]
  );

  return (
    <GitHubStatsContext.Provider value={contextValue}>
      {children}
    </GitHubStatsContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

export function useGitHubStats() {
  const context = useContext(GitHubStatsContext);
  if (!context) {
    throw new Error(
      "useGitHubStats must be used within a GitHubStatsProvider"
    );
  }
  return context;
}

export function useRepositoryStats(repositoryId: string) {
  const { state, getRepositoryById } = useGitHubStats();

  return useMemo(() => {
    const repository = getRepositoryById(repositoryId);
    return {
      repository,
      stats: repository?.stats ?? null,
      pullRequests: repository?.pullRequests ?? [],
      isLoading: state.isLoading,
    };
  }, [repositoryId, state.isLoading, getRepositoryById]);
}

export function useGitHubChanges() {
  const { state, markChangesSeen } = useGitHubStats();

  return useMemo(
    () => ({
      hasChanges: state.hasChanges,
      totalNewPRs: state.totalNewPRs,
      totalNewIssues: state.totalNewIssues,
      markChangesSeen,
    }),
    [state.hasChanges, state.totalNewPRs, state.totalNewIssues, markChangesSeen]
  );
}
