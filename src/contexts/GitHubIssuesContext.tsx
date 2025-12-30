"use client";

/**
 * GitHubIssuesContext - State management for GitHub issues
 *
 * Unlike GitHubStatsContext which polls all repos continuously, this context
 * fetches issues on-demand when a specific repository's issues are viewed.
 * Issues are cached per-repository with the same 15-minute TTL.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
} from "react";

// =============================================================================
// Types
// =============================================================================

/** Issue type matching the API response */
export interface GitHubIssueDTO {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  htmlUrl: string;
  author: { login: string; avatarUrl: string } | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string; avatarUrl: string }>;
  milestone: { title: string; number: number } | null;
  comments: number;
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
  cachedAt: string;
  bodyPreview: string | null;
  suggestedBranchName: string;
}

interface RepositoryIssuesState {
  issues: GitHubIssueDTO[];
  isLoading: boolean;
  error: string | null;
  cachedAt: Date | null;
  hasNewIssues: boolean;
  newIssueCount: number;
}

interface GitHubIssuesState {
  /** Issues per repository, keyed by repositoryId */
  byRepository: Map<string, RepositoryIssuesState>;
  /** Currently open modal's repository ID */
  activeRepositoryId: string | null;
}

type GitHubIssuesAction =
  | { type: "SET_LOADING"; repositoryId: string; isLoading: boolean }
  | {
      type: "SET_ISSUES";
      repositoryId: string;
      issues: GitHubIssueDTO[];
      cachedAt: Date;
      hasNewIssues: boolean;
      newIssueCount: number;
    }
  | { type: "SET_ERROR"; repositoryId: string; error: string }
  | { type: "MARK_SEEN"; repositoryId: string }
  | { type: "SET_ACTIVE_REPOSITORY"; repositoryId: string | null };

// =============================================================================
// Initial State & Reducer
// =============================================================================

const initialState: GitHubIssuesState = {
  byRepository: new Map(),
  activeRepositoryId: null,
};

function getDefaultRepoState(): RepositoryIssuesState {
  return {
    issues: [],
    isLoading: false,
    error: null,
    cachedAt: null,
    hasNewIssues: false,
    newIssueCount: 0,
  };
}

function reducer(
  state: GitHubIssuesState,
  action: GitHubIssuesAction
): GitHubIssuesState {
  switch (action.type) {
    case "SET_LOADING": {
      const newMap = new Map(state.byRepository);
      const existing = newMap.get(action.repositoryId) ?? getDefaultRepoState();
      newMap.set(action.repositoryId, {
        ...existing,
        isLoading: action.isLoading,
        error: null,
      });
      return { ...state, byRepository: newMap };
    }

    case "SET_ISSUES": {
      const newMap = new Map(state.byRepository);
      newMap.set(action.repositoryId, {
        issues: action.issues,
        isLoading: false,
        error: null,
        cachedAt: action.cachedAt,
        hasNewIssues: action.hasNewIssues,
        newIssueCount: action.newIssueCount,
      });
      return { ...state, byRepository: newMap };
    }

    case "SET_ERROR": {
      const newMap = new Map(state.byRepository);
      const existing = newMap.get(action.repositoryId) ?? getDefaultRepoState();
      newMap.set(action.repositoryId, {
        ...existing,
        isLoading: false,
        error: action.error,
      });
      return { ...state, byRepository: newMap };
    }

    case "MARK_SEEN": {
      const newMap = new Map(state.byRepository);
      const existing = newMap.get(action.repositoryId);
      if (existing) {
        newMap.set(action.repositoryId, {
          ...existing,
          hasNewIssues: false,
          newIssueCount: 0,
          issues: existing.issues.map((issue) => ({
            ...issue,
            isNew: false,
          })),
        });
      }
      return { ...state, byRepository: newMap };
    }

    case "SET_ACTIVE_REPOSITORY":
      return { ...state, activeRepositoryId: action.repositoryId };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface GitHubIssuesContextValue {
  state: GitHubIssuesState;
  /** Fetch issues for a repository (uses cache if valid) */
  fetchIssues: (repositoryId: string, forceRefresh?: boolean) => Promise<void>;
  /** Mark all issues in a repository as seen */
  markIssuesSeen: (repositoryId: string) => Promise<void>;
  /** Get issues for a specific repository */
  getIssues: (repositoryId: string) => RepositoryIssuesState;
  /** Set the active repository (for modal state) */
  setActiveRepository: (repositoryId: string | null) => void;
}

const GitHubIssuesContext = createContext<GitHubIssuesContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface GitHubIssuesProviderProps {
  children: React.ReactNode;
}

export function GitHubIssuesProvider({ children }: GitHubIssuesProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const fetchIssues = useCallback(
    async (repositoryId: string, forceRefresh: boolean = false) => {
      // Set loading state
      dispatch({ type: "SET_LOADING", repositoryId, isLoading: true });

      try {
        const url = new URL(
          `/api/github/repositories/${repositoryId}/issues`,
          window.location.origin
        );
        if (forceRefresh) {
          url.searchParams.set("refresh", "true");
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to fetch issues");
        }

        const data = await response.json();

        dispatch({
          type: "SET_ISSUES",
          repositoryId,
          issues: data.issues,
          cachedAt: data.meta.cachedAt ? new Date(data.meta.cachedAt) : new Date(),
          hasNewIssues: data.meta.hasNewIssues,
          newIssueCount: data.meta.newIssueCount,
        });
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          repositoryId,
          error: error instanceof Error ? error.message : "Failed to fetch issues",
        });
      }
    },
    []
  );

  const markIssuesSeen = useCallback(async (repositoryId: string) => {
    try {
      const response = await fetch("/api/github/issues/mark-seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId }),
      });

      if (response.ok) {
        dispatch({ type: "MARK_SEEN", repositoryId });
      }
    } catch (error) {
      console.error("Failed to mark issues as seen:", error);
    }
  }, []);

  const getIssues = useCallback(
    (repositoryId: string): RepositoryIssuesState => {
      return state.byRepository.get(repositoryId) ?? getDefaultRepoState();
    },
    [state.byRepository]
  );

  const setActiveRepository = useCallback((repositoryId: string | null) => {
    dispatch({ type: "SET_ACTIVE_REPOSITORY", repositoryId });
  }, []);

  const contextValue = useMemo(
    () => ({
      state,
      fetchIssues,
      markIssuesSeen,
      getIssues,
      setActiveRepository,
    }),
    [state, fetchIssues, markIssuesSeen, getIssues, setActiveRepository]
  );

  return (
    <GitHubIssuesContext.Provider value={contextValue}>
      {children}
    </GitHubIssuesContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useGitHubIssues() {
  const context = useContext(GitHubIssuesContext);
  if (!context) {
    throw new Error("useGitHubIssues must be used within GitHubIssuesProvider");
  }
  return context;
}

/**
 * Hook to get issues for a specific repository with auto-fetch
 */
export function useRepositoryIssues(repositoryId: string | null) {
  const { fetchIssues, getIssues, markIssuesSeen } = useGitHubIssues();

  const issuesState = repositoryId ? getIssues(repositoryId) : getDefaultRepoState();

  const refresh = useCallback(
    async (force: boolean = false) => {
      if (repositoryId) {
        await fetchIssues(repositoryId, force);
      }
    },
    [repositoryId, fetchIssues]
  );

  const markSeen = useCallback(async () => {
    if (repositoryId) {
      await markIssuesSeen(repositoryId);
    }
  }, [repositoryId, markIssuesSeen]);

  return {
    ...issuesState,
    refresh,
    markSeen,
  };
}
