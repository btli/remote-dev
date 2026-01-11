"use client";

/**
 * useExtensions - Hook for managing SDK extensions.
 *
 * Provides access to:
 * - List and load extensions
 * - Enable/disable extensions
 * - Get tools, prompts, and UI components from extensions
 * - Configure extension settings
 */

import { useState, useCallback, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirroring SDK types for client-side use)
// ─────────────────────────────────────────────────────────────────────────────

export type ExtensionPermission =
  | "files:read"
  | "files:write"
  | "terminal:execute"
  | "network:request"
  | "memory:read"
  | "memory:write"
  | "ui:render";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  permissions: ExtensionPermission[];
  entryPoint: string;
  config?: ExtensionConfigSchema;
}

export interface ExtensionConfigSchema {
  properties: Record<string, ExtensionConfigProperty>;
  required?: string[];
}

export interface ExtensionConfigProperty {
  type: "string" | "number" | "boolean" | "array";
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface LoadedExtension {
  manifest: ExtensionManifest;
  enabled: boolean;
  config: Record<string, unknown>;
  tools?: ToolDefinition[];
  prompts?: PromptTemplate[];
  uiComponents?: UIComponentDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  permissions?: ExtensionPermission[];
  examples?: ToolExample[];
  dangerous?: boolean;
  timeoutMs?: number;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
}

export interface ToolExample {
  input: Record<string, unknown>;
  output?: unknown;
  description?: string;
}

export interface PromptTemplate {
  name: string;
  description: string;
  template: string;
  variables: PromptVariable[];
  category?: string;
}

export interface PromptVariable {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  default?: unknown;
}

export interface UIComponentDefinition {
  id: string;
  name: string;
  description: string;
  location: "sidebar" | "toolbar" | "modal" | "panel";
  component: string;
  props?: Record<string, unknown>;
}

export interface UseExtensionsOptions {
  /** Auto-fetch on mount */
  autoFetch?: boolean;
  /** Polling interval in milliseconds. 0 = disabled. Default: 0 */
  pollInterval?: number;
}

export interface UseExtensionsReturn {
  /** All loaded extensions */
  extensions: LoadedExtension[];
  /** Available (registered but not loaded) extensions */
  available: ExtensionManifest[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh extensions list */
  refresh: () => Promise<void>;
  /** Load an extension */
  load: (extensionId: string) => Promise<LoadedExtension | null>;
  /** Unload an extension */
  unload: (extensionId: string) => Promise<boolean>;
  /** Enable an extension */
  enable: (extensionId: string) => Promise<boolean>;
  /** Disable an extension */
  disable: (extensionId: string) => Promise<boolean>;
  /** Update extension configuration */
  updateConfig: (extensionId: string, config: Record<string, unknown>) => Promise<boolean>;
  /** Register a new extension */
  register: (manifest: ExtensionManifest) => Promise<boolean>;
  /** Get all tools from loaded extensions */
  tools: ToolDefinition[];
  /** Get all prompts from loaded extensions */
  prompts: PromptTemplate[];
  /** Get all UI components from loaded extensions */
  uiComponents: UIComponentDefinition[];
  /** Get a specific tool by name */
  getTool: (name: string) => ToolDefinition | undefined;
  /** Get a specific prompt by name */
  getPrompt: (name: string) => PromptTemplate | undefined;
  /** Check if extension has permission */
  hasPermission: (extensionId: string, permission: ExtensionPermission) => boolean;
  /** Clear error state */
  clearError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useExtensions({
  autoFetch = true,
  pollInterval = 0,
}: UseExtensionsOptions = {}): UseExtensionsReturn {
  const [extensions, setExtensions] = useState<LoadedExtension[]>([]);
  const [available, setAvailable] = useState<ExtensionManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch extensions from API
   */
  const fetchExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sdk/extensions");

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const data = await response.json();
      setExtensions(data.loaded || []);
      setAvailable(data.available || []);
    } catch (err) {
      console.error("[useExtensions] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch extensions");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load an extension
   */
  const load = useCallback(
    async (extensionId: string): Promise<LoadedExtension | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sdk/extensions/${extensionId}/load`, {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(`Load failed: ${response.statusText}`);
        }

        const loadedExt = await response.json();

        // Update local state
        setExtensions((prev) => {
          const existing = prev.findIndex((e) => e.manifest.id === extensionId);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = loadedExt;
            return updated;
          }
          return [...prev, loadedExt];
        });

        return loadedExt;
      } catch (err) {
        console.error("[useExtensions] Load error:", err);
        setError(err instanceof Error ? err.message : "Failed to load extension");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Unload an extension
   */
  const unload = useCallback(async (extensionId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sdk/extensions/${extensionId}/unload`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Unload failed: ${response.statusText}`);
      }

      // Remove from local state
      setExtensions((prev) => prev.filter((e) => e.manifest.id !== extensionId));

      return true;
    } catch (err) {
      console.error("[useExtensions] Unload error:", err);
      setError(err instanceof Error ? err.message : "Failed to unload extension");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Enable an extension
   */
  const enable = useCallback(async (extensionId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sdk/extensions/${extensionId}/enable`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Enable failed: ${response.statusText}`);
      }

      // Update local state
      setExtensions((prev) =>
        prev.map((e) =>
          e.manifest.id === extensionId ? { ...e, enabled: true } : e
        )
      );

      return true;
    } catch (err) {
      console.error("[useExtensions] Enable error:", err);
      setError(err instanceof Error ? err.message : "Failed to enable extension");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Disable an extension
   */
  const disable = useCallback(async (extensionId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sdk/extensions/${extensionId}/disable`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Disable failed: ${response.statusText}`);
      }

      // Update local state
      setExtensions((prev) =>
        prev.map((e) =>
          e.manifest.id === extensionId ? { ...e, enabled: false } : e
        )
      );

      return true;
    } catch (err) {
      console.error("[useExtensions] Disable error:", err);
      setError(err instanceof Error ? err.message : "Failed to disable extension");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Update extension configuration
   */
  const updateConfig = useCallback(
    async (extensionId: string, config: Record<string, unknown>): Promise<boolean> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sdk/extensions/${extensionId}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });

        if (!response.ok) {
          throw new Error(`Update config failed: ${response.statusText}`);
        }

        // Update local state
        setExtensions((prev) =>
          prev.map((e) =>
            e.manifest.id === extensionId ? { ...e, config: { ...e.config, ...config } } : e
          )
        );

        return true;
      } catch (err) {
        console.error("[useExtensions] Update config error:", err);
        setError(err instanceof Error ? err.message : "Failed to update config");
        return false;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Register a new extension
   */
  const register = useCallback(async (manifest: ExtensionManifest): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sdk/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manifest),
      });

      if (!response.ok) {
        throw new Error(`Register failed: ${response.statusText}`);
      }

      // Add to available list
      setAvailable((prev) => [...prev, manifest]);

      return true;
    } catch (err) {
      console.error("[useExtensions] Register error:", err);
      setError(err instanceof Error ? err.message : "Failed to register extension");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get a specific tool by name
   */
  const getTool = useCallback(
    (name: string): ToolDefinition | undefined => {
      for (const ext of extensions) {
        const tool = ext.tools?.find((t) => t.name === name);
        if (tool) return tool;
      }
      return undefined;
    },
    [extensions]
  );

  /**
   * Get a specific prompt by name
   */
  const getPrompt = useCallback(
    (name: string): PromptTemplate | undefined => {
      for (const ext of extensions) {
        const prompt = ext.prompts?.find((p) => p.name === name);
        if (prompt) return prompt;
      }
      return undefined;
    },
    [extensions]
  );

  /**
   * Check if extension has a specific permission
   */
  const hasPermission = useCallback(
    (extensionId: string, permission: ExtensionPermission): boolean => {
      const ext = extensions.find((e) => e.manifest.id === extensionId);
      if (!ext) return false;
      return ext.manifest.permissions.includes(permission);
    },
    [extensions]
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initial fetch
  useEffect(() => {
    if (autoFetch) {
      fetchExtensions();
    }
  }, [autoFetch, fetchExtensions]);

  // Polling
  useEffect(() => {
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchExtensions, pollInterval);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [pollInterval, fetchExtensions]);

  // Aggregate tools, prompts, and UI components from all loaded extensions
  const tools = extensions.flatMap((e) => e.tools || []);
  const prompts = extensions.flatMap((e) => e.prompts || []);
  const uiComponents = extensions.flatMap((e) => e.uiComponents || []);

  return {
    extensions,
    available,
    loading,
    error,
    refresh: fetchExtensions,
    load,
    unload,
    enable,
    disable,
    updateConfig,
    register,
    tools,
    prompts,
    uiComponents,
    getTool,
    getPrompt,
    hasPermission,
    clearError,
  };
}
