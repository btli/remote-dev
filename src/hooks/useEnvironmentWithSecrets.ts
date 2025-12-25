"use client";

/**
 * Hook to get environment variables merged with secrets for a folder.
 *
 * This hook combines:
 * 1. Static environment variables from folder preferences
 * 2. Dynamic secrets fetched from the configured secrets provider (e.g., Phase)
 *
 * Secrets are fetched once per folder and cached for the session duration.
 * The hook returns the combined environment, with secrets taking precedence.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSecretsContext } from "@/contexts/SecretsContext";

interface UseEnvironmentWithSecretsResult {
  /**
   * Combined environment variables (folder prefs + secrets).
   * Returns null if folderId is null.
   */
  environment: Record<string, string> | null;

  /**
   * True while secrets are being fetched for the first time.
   */
  loading: boolean;

  /**
   * Force refresh secrets from the provider.
   */
  refreshSecrets: () => Promise<void>;
}

// Global cache for secrets by folder ID
// Using a module-level cache ensures secrets persist across component re-renders
const secretsCache = new Map<string, Record<string, string>>();
const fetchingFolders = new Set<string>();

export function useEnvironmentWithSecrets(
  folderId: string | null
): UseEnvironmentWithSecretsResult {
  const { getEnvironmentForFolder } = usePreferencesContext();
  const { fetchSecretsForFolder, getConfigForFolder } = useSecretsContext();

  const [secrets, setSecrets] = useState<Record<string, string> | null>(
    folderId ? (secretsCache.get(folderId) ?? null) : null
  );
  const [loading, setLoading] = useState(false);
  const hasFetchedRef = useRef(false);

  // Fetch secrets for the folder
  const fetchSecrets = useCallback(async () => {
    if (!folderId) return;

    // Check if we have a config for this folder
    const config = getConfigForFolder(folderId);
    if (!config || !config.enabled) {
      return;
    }

    // Prevent concurrent fetches for the same folder
    if (fetchingFolders.has(folderId)) {
      return;
    }

    setLoading(true);
    fetchingFolders.add(folderId);

    try {
      const fetchedSecrets = await fetchSecretsForFolder(folderId);
      if (fetchedSecrets) {
        secretsCache.set(folderId, fetchedSecrets);
        setSecrets(fetchedSecrets);
      }
    } finally {
      fetchingFolders.delete(folderId);
      setLoading(false);
    }
  }, [folderId, fetchSecretsForFolder, getConfigForFolder]);

  // Fetch secrets on mount if we have a folder with secrets config
  useEffect(() => {
    if (!folderId) return;

    // If we already have cached secrets, use them
    if (secretsCache.has(folderId)) {
      setSecrets(secretsCache.get(folderId)!);
      return;
    }

    // Only fetch once per folder
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    fetchSecrets();
  }, [folderId, fetchSecrets]);

  // Reset fetch flag when folder changes
  useEffect(() => {
    hasFetchedRef.current = false;
  }, [folderId]);

  // Get the base environment from folder preferences
  const folderEnv = getEnvironmentForFolder(folderId);

  // Merge folder environment with secrets (secrets take precedence)
  const environment =
    folderId === null
      ? null
      : secrets
        ? { ...folderEnv, ...secrets }
        : folderEnv;

  return {
    environment,
    loading,
    refreshSecrets: fetchSecrets,
  };
}

/**
 * Function to get environment with secrets for a folder.
 * This is a non-hook version that can be called from callbacks.
 *
 * Returns cached secrets merged with folder environment.
 * If secrets haven't been fetched yet, only returns folder environment.
 */
export function getEnvironmentWithSecretsSync(
  folderId: string | null,
  folderEnv: Record<string, string> | null
): Record<string, string> | null {
  if (!folderId) return null;

  const cachedSecrets = secretsCache.get(folderId);
  if (cachedSecrets) {
    return { ...folderEnv, ...cachedSecrets };
  }

  return folderEnv;
}

/**
 * Pre-fetch secrets for a folder.
 * Call this when a session is created to ensure secrets are available.
 */
export async function prefetchSecretsForFolder(
  folderId: string,
  fetchFn: (folderId: string) => Promise<Record<string, string> | null>
): Promise<Record<string, string> | null> {
  // Return cached if available
  if (secretsCache.has(folderId)) {
    return secretsCache.get(folderId)!;
  }

  // Fetch and cache
  const secrets = await fetchFn(folderId);
  if (secrets) {
    secretsCache.set(folderId, secrets);
  }

  return secrets;
}

/**
 * Clear cached secrets for a folder.
 * Call this when secrets config is updated.
 */
export function clearSecretsCache(folderId?: string): void {
  if (folderId) {
    secretsCache.delete(folderId);
  } else {
    secretsCache.clear();
  }
}
