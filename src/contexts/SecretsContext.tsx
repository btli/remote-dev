"use client";

/**
 * Secrets Context
 *
 * Manages state for folder secrets configurations.
 * Provides methods to fetch, update, and delete secrets configs.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type {
  FolderSecretsConfig,
  SecretsValidationResult,
  UpdateFolderSecretsConfigInput,
} from "@/types/secrets";
import { clearSecretsCache } from "@/hooks/useEnvironmentWithSecrets";

interface SecretsContextValue {
  // State
  folderConfigs: Map<string, FolderSecretsConfig>;
  loading: boolean;
  error: string | null;

  // Actions
  getConfigForFolder: (folderId: string) => FolderSecretsConfig | null;
  updateConfig: (
    folderId: string,
    input: UpdateFolderSecretsConfigInput
  ) => Promise<FolderSecretsConfig>;
  deleteConfig: (folderId: string) => Promise<void>;
  toggleEnabled: (folderId: string, enabled: boolean) => Promise<void>;
  testConnection: (
    provider: string,
    config: Record<string, string>
  ) => Promise<SecretsValidationResult>;
  refreshConfigs: () => Promise<void>;

  /**
   * Fetch actual secret values for a folder from the configured provider.
   * Returns null if no secrets are configured or provider is disabled.
   */
  fetchSecretsForFolder: (folderId: string) => Promise<Record<string, string> | null>;

  // Derived state
  hasAnyConfigs: boolean;
  configuredFolderIds: string[];
}

const SecretsContext = createContext<SecretsContextValue | null>(null);

interface SecretsProviderProps {
  children: ReactNode;
}

export function SecretsProvider({ children }: SecretsProviderProps) {
  const [folderConfigs, setFolderConfigs] = useState<Map<string, FolderSecretsConfig>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch on mount
  const refreshConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/secrets/configs");
      if (!response.ok) {
        throw new Error(`Failed to fetch secrets configs: ${response.statusText}`);
      }

      const configs: FolderSecretsConfig[] = await response.json();
      const configsMap = new Map(configs.map((c) => [c.folderId, c]));
      setFolderConfigs(configsMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Failed to fetch secrets configs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch configs on mount
  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  const getConfigForFolder = useCallback(
    (folderId: string): FolderSecretsConfig | null => {
      return folderConfigs.get(folderId) || null;
    },
    [folderConfigs]
  );

  const updateConfig = useCallback(
    async (
      folderId: string,
      input: UpdateFolderSecretsConfigInput
    ): Promise<FolderSecretsConfig> => {
      const response = await fetch(`/api/secrets/folders/${folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update secrets config");
      }

      const updated: FolderSecretsConfig = await response.json();

      // Update local state
      setFolderConfigs((prev) => {
        const next = new Map(prev);
        next.set(folderId, updated);
        return next;
      });

      // Clear cached secrets so new sessions fetch fresh values
      clearSecretsCache(folderId);

      return updated;
    },
    []
  );

  const deleteConfig = useCallback(async (folderId: string): Promise<void> => {
    const response = await fetch(`/api/secrets/folders/${folderId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to delete secrets config");
    }

    // Update local state
    setFolderConfigs((prev) => {
      const next = new Map(prev);
      next.delete(folderId);
      return next;
    });

    // Clear cached secrets since config is now deleted
    clearSecretsCache(folderId);
  }, []);

  const toggleEnabled = useCallback(
    async (folderId: string, enabled: boolean): Promise<void> => {
      const existing = folderConfigs.get(folderId);
      if (!existing) {
        throw new Error("No config found for folder");
      }

      const response = await fetch(`/api/secrets/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to toggle secrets config");
      }

      const updated: FolderSecretsConfig = await response.json();

      // Update local state
      setFolderConfigs((prev) => {
        const next = new Map(prev);
        next.set(folderId, updated);
        return next;
      });

      // Clear cached secrets since enabled state changed
      clearSecretsCache(folderId);
    },
    [folderConfigs]
  );

  const testConnection = useCallback(
    async (
      provider: string,
      config: Record<string, string>
    ): Promise<SecretsValidationResult> => {
      const response = await fetch("/api/secrets/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, config }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          valid: false,
          error: errorData.error || "Validation request failed",
        };
      }

      return await response.json();
    },
    []
  );

  /**
   * Fetch actual secret values for a folder from the configured provider.
   * Returns null if no secrets are configured or provider is disabled.
   */
  const fetchSecretsForFolderFn = useCallback(
    async (folderId: string): Promise<Record<string, string> | null> => {
      // Quick check: if we don't have a config for this folder, skip the API call
      const config = folderConfigs.get(folderId);
      if (!config || !config.enabled) {
        return null;
      }

      try {
        const response = await fetch(`/api/secrets/folders/${folderId}/secrets`);
        if (!response.ok) {
          console.error(`Failed to fetch secrets for folder ${folderId}:`, response.statusText);
          return null;
        }

        const secrets = await response.json();
        // Empty object means no secrets or provider disabled
        if (Object.keys(secrets).length === 0) {
          return null;
        }

        return secrets;
      } catch (err) {
        console.error("Error fetching secrets:", err);
        return null;
      }
    },
    [folderConfigs]
  );

  const hasAnyConfigs = folderConfigs.size > 0;
  const configuredFolderIds = useMemo(
    () => Array.from(folderConfigs.keys()),
    [folderConfigs]
  );

  const value = useMemo<SecretsContextValue>(
    () => ({
      folderConfigs,
      loading,
      error,
      getConfigForFolder,
      updateConfig,
      deleteConfig,
      toggleEnabled,
      testConnection,
      refreshConfigs,
      fetchSecretsForFolder: fetchSecretsForFolderFn,
      hasAnyConfigs,
      configuredFolderIds,
    }),
    [
      folderConfigs,
      loading,
      error,
      getConfigForFolder,
      updateConfig,
      deleteConfig,
      toggleEnabled,
      testConnection,
      refreshConfigs,
      fetchSecretsForFolderFn,
      hasAnyConfigs,
      configuredFolderIds,
    ]
  );

  return (
    <SecretsContext.Provider value={value}>{children}</SecretsContext.Provider>
  );
}

export function useSecretsContext(): SecretsContextValue {
  const context = useContext(SecretsContext);
  if (!context) {
    throw new Error("useSecretsContext must be used within SecretsProvider");
  }
  return context;
}

/**
 * Hook to get secrets config for a specific folder
 */
export function useFolderSecretsConfig(folderId: string | null): {
  config: FolderSecretsConfig | null;
  loading: boolean;
} {
  const { getConfigForFolder, loading } = useSecretsContext();

  const config = useMemo(
    () => (folderId ? getConfigForFolder(folderId) : null),
    [folderId, getConfigForFolder]
  );

  return { config, loading };
}
