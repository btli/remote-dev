"use client";

/**
 * LiteLLM Context
 *
 * Manages state for the LiteLLM proxy.
 * Provides methods to control the proxy, manage models, and view usage analytics.
 * Polls status every 10s when enabled and analytics every 60s when running.
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
  LiteLLMConfig,
  LiteLLMModel,
  LiteLLMStatus,
  UsageStats,
  UpdateLiteLLMConfigInput,
  AddLiteLLMModelInput,
} from "@/types/litellm";

interface LiteLLMContextValue {
  config: LiteLLMConfig | null;
  status: LiteLLMStatus;
  models: LiteLLMModel[];
  usageStats: UsageStats | null;
  loading: boolean;

  updateConfig: (input: UpdateLiteLLMConfigInput) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  addModel: (input: AddLiteLLMModelInput) => Promise<void>;
  updateModel: (modelId: string, input: Partial<AddLiteLLMModelInput>) => Promise<void>;
  removeModel: (modelId: string) => Promise<void>;
  toggleModelPause: (modelId: string) => Promise<void>;
  setDefaultModel: (modelId: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshModels: () => Promise<void>;

  isRunning: boolean;
  proxyUrl: string | null;
}

const DEFAULT_STATUS: LiteLLMStatus = {
  installed: false,
  running: false,
  port: null,
  pid: null,
  version: null,
  uptime: null,
};

const LiteLLMContext = createContext<LiteLLMContextValue | null>(null);

interface LiteLLMProviderProps {
  children: ReactNode;
}

export function LiteLLMProvider({ children }: LiteLLMProviderProps) {
  const [config, setConfig] = useState<LiteLLMConfig | null>(null);
  const [status, setStatus] = useState<LiteLLMStatus>(DEFAULT_STATUS);
  const [models, setModels] = useState<LiteLLMModel[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/litellm");
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
      const response = await fetch("/api/litellm/status");
      if (!response.ok) return;
      const data: LiteLLMStatus = await response.json();
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

  // Fetch models
  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch("/api/litellm/models");
      if (!response.ok) return;
      const data = await response.json();
      setModels(data.models ?? data);
    } catch {
      // Silently handle
    }
  }, []);

  // Fetch analytics/usage stats
  const refreshStats = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const response = await fetch(
        `/api/litellm/analytics?type=summary&start=${encodeURIComponent(sevenDaysAgo)}`
      );
      if (!response.ok) return;
      const data: UsageStats = await response.json();
      setUsageStats(data);
    } catch {
      // Silently handle
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchConfig(), refreshStatus(), fetchModels()]);
      setLoading(false);
    };
    init();
  }, [fetchConfig, refreshStatus, fetchModels]);

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

  // Poll analytics every 60s when running
  useEffect(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (status.running) {
      // Fetch immediately when proxy starts running
      refreshStats();
      statsIntervalRef.current = setInterval(refreshStats, 60_000);
    } else {
      setUsageStats(null);
    }

    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [status.running, refreshStats]);

  // Update config
  const updateConfig = useCallback(async (input: UpdateLiteLLMConfigInput) => {
    try {
      const response = await fetch("/api/litellm", {
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
      const response = await fetch("/api/litellm/control", {
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
      const response = await fetch("/api/litellm/control", {
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
      const response = await fetch("/api/litellm/control", {
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

  // Model management
  const addModel = useCallback(async (input: AddLiteLLMModelInput) => {
    try {
      const response = await fetch("/api/litellm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add model");
      }

      const newModel: LiteLLMModel = await response.json();
      setModels((prev) => [...prev, newModel]);
      toast.success("Model added");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add model";
      toast.error(message);
      throw err;
    }
  }, []);

  const updateModel = useCallback(async (modelId: string, input: Partial<AddLiteLLMModelInput>) => {
    try {
      const response = await fetch(`/api/litellm/models/${modelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update model");
      }

      const updated: LiteLLMModel = await response.json();
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? updated : m))
      );
      toast.success("Model updated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update model";
      toast.error(message);
      throw err;
    }
  }, []);

  const removeModel = useCallback(async (modelId: string) => {
    try {
      const response = await fetch(`/api/litellm/models/${modelId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to remove model");
      }

      setModels((prev) => prev.filter((m) => m.id !== modelId));
      toast.success("Model removed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove model";
      toast.error(message);
      throw err;
    }
  }, []);

  const toggleModelPause = useCallback(async (modelId: string) => {
    try {
      const response = await fetch(`/api/litellm/models/${modelId}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to toggle model");
      }

      const updated: LiteLLMModel = await response.json();
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? updated : m))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to toggle model";
      toast.error(message);
      throw err;
    }
  }, []);

  const setDefaultModel = useCallback(async (modelId: string) => {
    try {
      const response = await fetch(`/api/litellm/models/${modelId}/default`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to set default model");
      }

      // Refresh models to get updated default flags
      await fetchModels();
      toast.success("Default model updated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to set default model";
      toast.error(message);
      throw err;
    }
  }, [fetchModels]);

  const isRunning = status.running;
  const proxyUrl = isRunning && status.port
    ? `http://localhost:${status.port}`
    : null;

  const value = useMemo<LiteLLMContextValue>(
    () => ({
      config,
      status,
      models,
      usageStats,
      loading,

      updateConfig,
      start,
      stop,
      restart,
      addModel,
      updateModel,
      removeModel,
      toggleModelPause,
      setDefaultModel,
      refreshStatus,
      refreshStats,
      refreshModels: fetchModels,
      isRunning,
      proxyUrl,
    }),
    [
      config,
      status,
      models,
      usageStats,
      loading,

      updateConfig,
      start,
      stop,
      restart,
      addModel,
      updateModel,
      removeModel,
      toggleModelPause,
      setDefaultModel,
      refreshStatus,
      refreshStats,
      fetchModels,
      isRunning,
      proxyUrl,
    ]
  );

  return (
    <LiteLLMContext.Provider value={value}>{children}</LiteLLMContext.Provider>
  );
}

export function useLiteLLMContext(): LiteLLMContextValue {
  const context = useContext(LiteLLMContext);
  if (!context) {
    throw new Error("useLiteLLMContext must be used within LiteLLMProvider");
  }
  return context;
}
