"use client";

/**
 * GitHubAccountContext - Context for managing multiple linked GitHub accounts.
 *
 * Provides:
 * - List of linked GitHub accounts with metadata
 * - Project-to-account bindings
 * - CRUD operations: set default, bind/unbind project, unlink
 * - "Add Account" flow via OAuth
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

export interface LinkedGitHubAccount {
  providerAccountId: string;
  userId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string;
  email: string | null;
  isDefault: boolean;
  needsReauth: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GitHubAccountContextValue {
  accounts: LinkedGitHubAccount[];
  // projectId -> providerAccountId. The server returns this map in the
  // `folderBindings` response field for historical back-compat; the keys
  // are project ids post-refactor.
  folderBindings: Record<string, string>;
  loading: boolean;
  error: string | null;

  // Actions
  refresh: () => Promise<void>;
  setDefault: (providerAccountId: string) => Promise<void>;
  unlinkAccount: (providerAccountId: string) => Promise<void>;
  bindProject: (projectId: string, providerAccountId: string) => Promise<void>;
  unbindProject: (projectId: string) => Promise<void>;
  addAccount: () => void;

  // Helpers
  getAccountForProject: (projectId: string) => LinkedGitHubAccount | undefined;
  defaultAccount: LinkedGitHubAccount | undefined;
}

const GitHubAccountContext = createContext<GitHubAccountContextValue | null>(null);

interface GitHubAccountProviderProps {
  children: ReactNode;
  initialHasAccounts?: boolean;
}

export function GitHubAccountProvider({
  children,
  initialHasAccounts = false,
}: GitHubAccountProviderProps) {
  const [accounts, setAccounts] = useState<LinkedGitHubAccount[]>([]);
  const [folderBindings, setFolderBindings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setFolderBindings(data.folderBindings ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  // Load accounts on mount if we know there are accounts
  useEffect(() => {
    if (initialHasAccounts && !initialized) {
      refresh();
    } else {
      setInitialized(true);
    }
  }, [initialHasAccounts, initialized, refresh]);

  const setDefault = useCallback(async (providerAccountId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/github/accounts/${providerAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-default" }),
      });
      if (!res.ok) throw new Error("Failed to set default account");
      // Optimistic update
      setAccounts((prev) =>
        prev.map((a) => ({
          ...a,
          isDefault: a.providerAccountId === providerAccountId,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const unlinkAccount = useCallback(async (providerAccountId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/github/accounts/${providerAccountId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unlink account");
      // Refresh to get accurate state from server (default promotion, binding cleanup)
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [refresh]);

  const bindProject = useCallback(async (projectId: string, providerAccountId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/github/accounts/${providerAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bind-project", projectId }),
      });
      if (!res.ok) throw new Error("Failed to bind project");
      setFolderBindings((prev) => ({ ...prev, [projectId]: providerAccountId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const unbindProject = useCallback(async (projectId: string) => {
    setError(null);
    // Find which account is currently bound to get the accountId for the API call
    const providerAccountId = folderBindings[projectId];
    if (!providerAccountId) return;
    try {
      const res = await fetch(`/api/github/accounts/${providerAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unbind-project", projectId }),
      });
      if (!res.ok) throw new Error("Failed to unbind project");
      setFolderBindings((prev) => {
        const updated = { ...prev };
        delete updated[projectId];
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [folderBindings]);

  const addAccount = useCallback(() => {
    window.location.href = "/api/auth/github/link";
  }, []);

  const getAccountForProject = useCallback(
    (projectId: string) => {
      const accountId = folderBindings[projectId];
      if (!accountId) return undefined;
      return accounts.find((a) => a.providerAccountId === accountId);
    },
    [accounts, folderBindings]
  );

  const defaultAccount = useMemo(
    () => accounts.find((a) => a.isDefault),
    [accounts]
  );

  const value = useMemo(
    () => ({
      accounts,
      folderBindings,
      loading,
      error,
      refresh,
      setDefault,
      unlinkAccount,
      bindProject,
      unbindProject,
      addAccount,
      getAccountForProject,
      defaultAccount,
    }),
    [
      accounts,
      folderBindings,
      loading,
      error,
      refresh,
      setDefault,
      unlinkAccount,
      bindProject,
      unbindProject,
      addAccount,
      getAccountForProject,
      defaultAccount,
    ]
  );

  return (
    <GitHubAccountContext.Provider value={value}>
      {children}
    </GitHubAccountContext.Provider>
  );
}

export function useGitHubAccounts() {
  const context = useContext(GitHubAccountContext);
  if (!context) {
    throw new Error("useGitHubAccounts must be used within a GitHubAccountProvider");
  }
  return context;
}
