"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  language: string | null;
  stars: number;
  updatedAt: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface Branch {
  name: string;
  isRemote: boolean;
  isDefault: boolean;
}

interface UseGitHubRepositoriesReturn {
  repositories: GitHubRepo[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  isConnected: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  cloneRepository: (repoId: string) => Promise<{ localPath: string }>;
  getBranches: (repoId: string) => Promise<Branch[]>;
  search: (query: string) => GitHubRepo[];
}

export function useGitHubRepositories(): UseGitHubRepositoriesReturn {
  const [repositories, setRepositories] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  const fetchRepositories = useCallback(async (pageNum: number, reset = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/github/repositories?page=${pageNum}&perPage=50&sort=updated`
      );

      if (!response.ok) {
        const data = await response.json();
        if (data.code === "GITHUB_NOT_CONNECTED") {
          setIsConnected(false);
          setRepositories([]);
          return;
        }
        throw new Error(data.error || "Failed to fetch repositories");
      }

      setIsConnected(true);
      const data = await response.json();

      if (reset) {
        setRepositories(data.repositories);
      } else {
        setRepositories((prev) => [...prev, ...data.repositories]);
      }

      setHasMore(data.hasMore);
      setPage(pageNum);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    await fetchRepositories(page + 1);
  }, [fetchRepositories, hasMore, loading, page]);

  const refresh = useCallback(async () => {
    await fetchRepositories(1, true);
  }, [fetchRepositories]);

  const cloneRepository = useCallback(
    async (repoId: string): Promise<{ localPath: string }> => {
      const response = await fetch(`/api/github/repositories/${repoId}`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to clone repository");
      }

      return response.json();
    },
    []
  );

  const getBranches = useCallback(
    async (repoId: string): Promise<Branch[]> => {
      const response = await fetch(
        `/api/github/repositories/${repoId}/branches`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch branches");
      }

      const data = await response.json();
      return data.branches;
    },
    []
  );

  const search = useCallback(
    (query: string): GitHubRepo[] => {
      if (!query.trim()) return repositories;

      const lowerQuery = query.toLowerCase();
      return repositories.filter(
        (repo) =>
          repo.name.toLowerCase().includes(lowerQuery) ||
          repo.fullName.toLowerCase().includes(lowerQuery) ||
          repo.description?.toLowerCase().includes(lowerQuery)
      );
    },
    [repositories]
  );

  // Fetch on mount
  const didInitialFetchRef = useRef(false);
  useEffect(() => {
    if (didInitialFetchRef.current) return;
    didInitialFetchRef.current = true;
    fetchRepositories(1, true);
  }, [fetchRepositories]);

  return {
    repositories,
    loading,
    error,
    hasMore,
    isConnected,
    loadMore,
    refresh,
    cloneRepository,
    getBranches,
    search,
  };
}
