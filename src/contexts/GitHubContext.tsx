"use client";

/**
 * GitHubContext - Context provider for GitHub account and repository management
 *
 * Provides:
 * - Connection state and account info
 * - Repository list with stats
 * - CRUD operations for repository management
 * - Optimistic updates with server sync
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type {
  GitHubAccountInfo,
  CachedRepositoryWithStats,
} from "@/services/github-account-service";

/**
 * API response types
 */
interface AccountResponse {
  connected: boolean;
  account: GitHubAccountInfo | null;
  stats: {
    totalRepos: number;
    clonedRepos: number;
    totalDiskSize: number;
    totalDiskSizeFormatted: string;
    lastSync: string | null;
  } | null;
}

interface RefreshResponse {
  success: boolean;
  repositories: CachedRepositoryWithStats[];
  stats: {
    totalRepos: number;
    clonedRepos: number;
    totalDiskSize: number;
    totalDiskSizeFormatted: string;
    lastSync: string | null;
  };
}

/**
 * Context value interface
 */
interface GitHubContextValue {
  // Connection state
  isConnected: boolean;
  accountInfo: GitHubAccountInfo | null;
  loading: boolean;
  error: string | null;

  // Repository management
  repositories: CachedRepositoryWithStats[];
  refreshRepositories: () => Promise<void>;
  deleteRepository: (repoId: string, removeFiles?: boolean) => Promise<void>;
  recloneRepository: (repoId: string) => Promise<void>;
  clearAllCache: (removeFiles?: boolean) => Promise<void>;

  // Account actions
  disconnect: (clearCache?: boolean) => Promise<void>;
  forceRefreshAll: () => Promise<void>;

  // Stats
  stats: {
    totalRepos: number;
    clonedRepos: number;
    totalDiskSize: number;
    totalDiskSizeFormatted: string;
    lastSync: Date | null;
  };

  // Modal control
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const GitHubContext = createContext<GitHubContextValue | null>(null);

interface GitHubProviderProps {
  children: ReactNode;
  initialIsConnected: boolean;
}

export function GitHubProvider({
  children,
  initialIsConnected,
}: GitHubProviderProps) {
  // State
  const [isConnected, setIsConnected] = useState(initialIsConnected);
  const [accountInfo, setAccountInfo] = useState<GitHubAccountInfo | null>(
    null
  );
  const [repositories, setRepositories] = useState<CachedRepositoryWithStats[]>(
    []
  );
  const [stats, setStats] = useState<{
    totalRepos: number;
    clonedRepos: number;
    totalDiskSize: number;
    totalDiskSizeFormatted: string;
    lastSync: Date | null;
  }>({
    totalRepos: 0,
    clonedRepos: 0,
    totalDiskSize: 0,
    totalDiskSizeFormatted: "0 B",
    lastSync: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch account data
  const fetchAccountData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/account");
      if (!response.ok) {
        throw new Error("Failed to fetch account data");
      }

      const data: AccountResponse = await response.json();

      setIsConnected(data.connected);
      setAccountInfo(data.account);

      if (data.stats) {
        setStats({
          totalRepos: data.stats.totalRepos,
          clonedRepos: data.stats.clonedRepos,
          totalDiskSize: data.stats.totalDiskSize,
          totalDiskSizeFormatted: data.stats.totalDiskSizeFormatted,
          lastSync: data.stats.lastSync ? new Date(data.stats.lastSync) : null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh repositories from cache
  const refreshRepositories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/repositories?cached=true");
      if (!response.ok) {
        throw new Error("Failed to fetch repositories");
      }

      const data = await response.json();

      // Map to CachedRepositoryWithStats format
      const repos: CachedRepositoryWithStats[] = data.repositories.map(
        (repo: {
          id: string;
          name: string;
          fullName: string;
          isPrivate: boolean;
          localPath: string | null;
          defaultBranch: string;
          updatedAt: string;
        }) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          isPrivate: repo.isPrivate,
          localPath: repo.localPath,
          defaultBranch: repo.defaultBranch,
          cloneUrl: `https://github.com/${repo.fullName}.git`,
          lastUpdated: new Date(repo.updatedAt),
          diskSize: null, // Would need separate API call for disk size
          cloneStatus: repo.localPath ? "cloned" : "not_cloned",
        })
      );

      setRepositories(repos);

      // Update stats
      setStats((prev) => ({
        ...prev,
        totalRepos: repos.length,
        clonedRepos: repos.filter((r) => r.localPath).length,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Force refresh all from GitHub API
  const forceRefreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/account", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to refresh repositories");
      }

      const data: RefreshResponse = await response.json();

      setRepositories(data.repositories);
      setStats({
        totalRepos: data.stats.totalRepos,
        clonedRepos: data.stats.clonedRepos,
        totalDiskSize: data.stats.totalDiskSize,
        totalDiskSizeFormatted: data.stats.totalDiskSizeFormatted,
        lastSync: data.stats.lastSync ? new Date(data.stats.lastSync) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete repository
  const deleteRepository = useCallback(
    async (repoId: string, removeFiles: boolean = false) => {
      // Optimistic update
      const previousRepos = repositories;
      setRepositories((prev) => prev.filter((r) => r.id !== repoId));

      try {
        const response = await fetch(
          `/api/github/repositories/${repoId}?removeFiles=${removeFiles}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          throw new Error("Failed to delete repository");
        }

        // Update stats
        setStats((prev) => ({
          ...prev,
          totalRepos: prev.totalRepos - 1,
          clonedRepos:
            prev.clonedRepos -
            (previousRepos.find((r) => r.id === repoId)?.localPath ? 1 : 0),
        }));
      } catch (err) {
        // Rollback on error
        setRepositories(previousRepos);
        setError(err instanceof Error ? err.message : "Unknown error");
        throw err;
      }
    },
    [repositories]
  );

  // Re-clone repository
  const recloneRepository = useCallback(async (repoId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/github/repositories/${repoId}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to clone repository");
      }

      const data = await response.json();

      // Update repository in list
      setRepositories((prev) =>
        prev.map((r) =>
          r.id === repoId
            ? { ...r, localPath: data.localPath, cloneStatus: "cloned" as const }
            : r
        )
      );

      // Update stats
      setStats((prev) => ({
        ...prev,
        clonedRepos: prev.clonedRepos + 1,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Clear all cache
  const clearAllCache = useCallback(
    async (removeFiles: boolean = false) => {
      setLoading(true);
      setError(null);

      try {
        // Clear via account API with clearCache flag and optional file removal
        const response = await fetch(
          `/api/github/account?clearCache=true&removeFiles=${removeFiles}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          throw new Error("Failed to clear cache");
        }

        // This disconnects GitHub, so update state accordingly
        setIsConnected(false);
        setAccountInfo(null);
        setRepositories([]);
        setStats({
          totalRepos: 0,
          clonedRepos: 0,
          totalDiskSize: 0,
          totalDiskSizeFormatted: "0 B",
          lastSync: null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Disconnect GitHub
  const disconnect = useCallback(async (clearCache: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/github/account?clearCache=${clearCache}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to disconnect GitHub");
      }

      setIsConnected(false);
      setAccountInfo(null);

      if (clearCache) {
        setRepositories([]);
        setStats({
          totalRepos: 0,
          clonedRepos: 0,
          totalDiskSize: 0,
          totalDiskSizeFormatted: "0 B",
          lastSync: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Modal controls
  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Fetch data when modal opens
  useEffect(() => {
    if (isModalOpen && isConnected) {
      fetchAccountData();
      refreshRepositories();
    }
  }, [isModalOpen, isConnected, fetchAccountData, refreshRepositories]);

  // Memoize context value
  const value = useMemo(
    () => ({
      isConnected,
      accountInfo,
      loading,
      error,
      repositories,
      refreshRepositories,
      deleteRepository,
      recloneRepository,
      clearAllCache,
      disconnect,
      forceRefreshAll,
      stats,
      isModalOpen,
      openModal,
      closeModal,
    }),
    [
      isConnected,
      accountInfo,
      loading,
      error,
      repositories,
      refreshRepositories,
      deleteRepository,
      recloneRepository,
      clearAllCache,
      disconnect,
      forceRefreshAll,
      stats,
      isModalOpen,
      openModal,
      closeModal,
    ]
  );

  return (
    <GitHubContext.Provider value={value}>{children}</GitHubContext.Provider>
  );
}

/**
 * Hook to access GitHub context
 */
export function useGitHubContext() {
  const context = useContext(GitHubContext);
  if (!context) {
    throw new Error("useGitHubContext must be used within a GitHubProvider");
  }
  return context;
}
