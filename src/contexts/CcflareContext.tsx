"use client";

/**
 * Ccflare Context
 *
 * Manages state for the ccflare Anthropic API proxy.
 * Provides methods to control the proxy, manage API keys, and view stats.
 * Polls status every 10s when enabled and stats every 30s when running.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type {
  CcflareConfig,
  CcflareApiKey,
  CcflareStatus,
  CcflareStats,
  UpdateCcflareConfigInput,
  AddCcflareKeyInput,
} from "@/types/ccflare";

/** Active proxy state reported by agent sessions via PreToolUse hook. */
export interface ProxyState {
  sessionId: string;
  baseUrl: string | null;
  keyPrefix: string | null;
}

interface CcflareContextValue {
  config: CcflareConfig | null;
  status: CcflareStatus;
  keys: CcflareApiKey[];
  stats: CcflareStats | null;
  loading: boolean;
  /** Latest proxy state reported by an agent session. */
  activeProxyState: ProxyState | null;

  updateConfig: (input: UpdateCcflareConfigInput) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  addKey: (input: AddCcflareKeyInput) => Promise<void>;
  createAlias: (input: { name: string; baseUrl?: string; keyPrefix?: string }) => Promise<CcflareApiKey>;
  removeKey: (keyId: string) => Promise<void>;
  toggleKeyPause: (keyId: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshStats: () => Promise<void>;

  isRunning: boolean;
  proxyUrl: string | null;
}

const DEFAULT_STATUS: CcflareStatus = {
  installed: false,
  running: false,
  port: null,
  pid: null,
  version: null,
  uptime: null,
};

const CcflareContext = createContext<CcflareContextValue | null>(null);

interface CcflareProviderProps {
  children: ReactNode;
}

export function CcflareProvider({ children }: CcflareProviderProps) {
  const [config, setConfig] = useState<CcflareConfig | null>(null);
  const [status, setStatus] = useState<CcflareStatus>(DEFAULT_STATUS);
  const [keys, setKeys] = useState<CcflareApiKey[]>([]);
  const [stats, setStats] = useState<CcflareStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProxyState, setActiveProxyState] = useState<ProxyState | null>(null);

  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare");
      if (!response.ok) return;
      const data = await response.json();
      setConfig(data.config ?? data);
    } catch {
      // Config may not exist yet, that's fine
    }
  }, []);

  // Fetch status (with change detection to avoid unnecessary re-renders)
  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/status");
      if (!response.ok) return;
      const data: CcflareStatus = await response.json();
      setStatus((prev) => {
        if (
          prev.running === data.running &&
          prev.port === data.port &&
          prev.pid === data.pid &&
          prev.installed === data.installed
        ) {
          return prev;
        }
        return data;
      });
    } catch {
      // Silently handle - proxy may not be installed
    }
  }, []);

  // Fetch keys
  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/keys");
      if (!response.ok) return;
      const data = await response.json();
      setKeys(data.keys ?? data);
    } catch {
      // Silently handle
    }
  }, []);

  // Fetch stats
  const refreshStats = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/stats");
      if (!response.ok) return;
      const data: CcflareStats = await response.json();
      setStats(data);
    } catch {
      // Silently handle
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchConfig(), refreshStatus(), fetchKeys()]);
      setLoading(false);
    };
    init();
  }, [fetchConfig, refreshStatus, fetchKeys]);

  // Poll status every 10s when enabled
  useEffect(() => {
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }

    if (config?.enabled) {
      statusIntervalRef.current = setInterval(refreshStatus, 10_000);
    }

    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, [config?.enabled, refreshStatus]);

  // Poll stats every 30s when running
  useEffect(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (status.running) {
      // Fetch immediately when proxy starts running
      refreshStats();
      statsIntervalRef.current = setInterval(refreshStats, 30_000);
    } else {
      setStats(null);
    }

    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [status.running, refreshStats]);

  // Listen for proxy state events from agent sessions (dispatched via WebSocket → CustomEvent)
  useEffect(() => {
    function handleProxyState(e: Event) {
      const { sessionId, baseUrl, keyPrefix } = (e as CustomEvent).detail;
      setActiveProxyState({ sessionId, baseUrl: baseUrl || null, keyPrefix: keyPrefix || null });
    }
    document.addEventListener("rdv:proxy-state", handleProxyState);
    return () => document.removeEventListener("rdv:proxy-state", handleProxyState);
  }, []);

  // Update config
  const updateConfig = useCallback(async (input: UpdateCcflareConfigInput) => {
    try {
      const response = await fetch("/api/ccflare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update config");
      }

      const data = await response.json();
      setConfig(data.config ?? data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update config";
      toast.error(message);
      throw err;
    }
  }, []);

  // Control actions
  const start = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to start proxy");
      }

      toast.success("Proxy started");
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start proxy";
      toast.error(message);
      throw err;
    }
  }, [refreshStatus]);

  const stop = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to stop proxy");
      }

      toast.success("Proxy stopped");
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop proxy";
      toast.error(message);
      throw err;
    }
  }, [refreshStatus]);

  const restart = useCallback(async () => {
    try {
      const response = await fetch("/api/ccflare/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to restart proxy");
      }

      toast.success("Proxy restarted");
      await refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to restart proxy";
      toast.error(message);
      throw err;
    }
  }, [refreshStatus]);

  // Key management
  const addKey = useCallback(async (input: AddCcflareKeyInput) => {
    try {
      const response = await fetch("/api/ccflare/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add key");
      }

      const newKey: CcflareApiKey = await response.json();
      setKeys((prev) => [...prev, newKey]);
      toast.success("API key added");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add key";
      toast.error(message);
      throw err;
    }
  }, []);

  const createAlias = useCallback(async (input: { name: string; baseUrl?: string; keyPrefix?: string }): Promise<CcflareApiKey> => {
    const response = await fetch("/api/ccflare/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, aliasOnly: true }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to create alias");
    }

    const newKey: CcflareApiKey = await response.json();
    setKeys((prev) => [...prev, newKey]);
    return newKey;
  }, []);

  const removeKey = useCallback(async (keyId: string) => {
    try {
      const response = await fetch(`/api/ccflare/keys/${keyId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to remove key");
      }

      setKeys((prev) => prev.filter((k) => k.id !== keyId));
      toast.success("API key removed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove key";
      toast.error(message);
      throw err;
    }
  }, []);

  const toggleKeyPause = useCallback(async (keyId: string) => {
    try {
      const response = await fetch(`/api/ccflare/keys/${keyId}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to toggle key");
      }

      const updated: CcflareApiKey = await response.json();
      setKeys((prev) =>
        prev.map((k) => (k.id === keyId ? updated : k))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to toggle key";
      toast.error(message);
      throw err;
    }
  }, []);

  const isRunning = status.running;
  const proxyUrl = isRunning && status.port
    ? `http://localhost:${status.port}`
    : null;

  const value = useMemo<CcflareContextValue>(
    () => ({
      config,
      status,
      keys,
      stats,
      loading,
      activeProxyState,
      updateConfig,
      start,
      stop,
      restart,
      addKey,
      createAlias,
      removeKey,
      toggleKeyPause,
      refreshStatus,
      refreshStats,
      isRunning,
      proxyUrl,
    }),
    [
      config,
      status,
      keys,
      stats,
      loading,
      activeProxyState,
      updateConfig,
      start,
      stop,
      restart,
      addKey,
      createAlias,
      removeKey,
      toggleKeyPause,
      refreshStatus,
      refreshStats,
      isRunning,
      proxyUrl,
    ]
  );

  return (
    <CcflareContext.Provider value={value}>{children}</CcflareContext.Provider>
  );
}

export function useCcflareContext(): CcflareContextValue {
  const context = useContext(CcflareContext);
  if (!context) {
    throw new Error("useCcflareContext must be used within CcflareProvider");
  }
  return context;
}
