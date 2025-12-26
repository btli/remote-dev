"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  DevServerState,
  DevServerStatus,
  StartDevServerResponse,
  DevServerConfig,
} from "@/types/dev-server";

interface DevServerContextValue {
  /** Map of folderId -> DevServerState for active servers */
  devServers: Map<string, DevServerState>;
  /** Whether the context is loading */
  loading: boolean;
  /** Start a dev server for a folder */
  startDevServer: (folderId: string) => Promise<StartDevServerResponse>;
  /** Stop a dev server for a folder */
  stopDevServer: (folderId: string) => Promise<void>;
  /** Restart a dev server for a folder */
  restartDevServer: (folderId: string) => Promise<StartDevServerResponse>;
  /** Get dev server state for a folder */
  getDevServer: (folderId: string) => DevServerState | undefined;
  /** Check if a folder has an active dev server */
  hasDevServer: (folderId: string) => boolean;
  /** Get dev server config for a folder */
  getDevServerConfig: (folderId: string) => Promise<DevServerConfig | null>;
  /** Refresh dev server state */
  refreshDevServers: () => Promise<void>;
  /** Update a dev server's status locally (used by WebSocket updates) */
  updateDevServerStatus: (folderId: string, status: DevServerStatus) => void;
}

const DevServerContext = createContext<DevServerContextValue | null>(null);

interface DevServerProviderProps {
  children: ReactNode;
}

export function DevServerProvider({ children }: DevServerProviderProps) {
  const [devServers, setDevServers] = useState<Map<string, DevServerState>>(new Map());
  const [loading, setLoading] = useState(true);

  const refreshDevServers = useCallback(async () => {
    try {
      const response = await fetch("/api/dev-servers");
      if (!response.ok) throw new Error("Failed to fetch dev servers");
      const data = await response.json();

      const newMap = new Map<string, DevServerState>();
      for (const server of data.devServers) {
        newMap.set(server.folderId, server);
      }
      setDevServers(newMap);
    } catch (error) {
      console.error("Error fetching dev servers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch dev servers on mount
  useEffect(() => {
    refreshDevServers();
  }, [refreshDevServers]);

  // Poll for status updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(refreshDevServers, 5000);
    return () => clearInterval(interval);
  }, [refreshDevServers]);

  const startDevServer = useCallback(
    async (folderId: string): Promise<StartDevServerResponse> => {
      const response = await fetch("/api/dev-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start dev server");
      }

      const result: StartDevServerResponse = await response.json();

      // Optimistically update state
      setDevServers((prev) => {
        const next = new Map(prev);
        next.set(folderId, {
          sessionId: result.sessionId,
          folderId,
          folderName: "", // Will be filled on refresh
          port: result.port,
          status: result.status,
          proxyUrl: result.proxyUrl,
          health: null,
          isStarting: true,
        });
        return next;
      });

      // Refresh to get full state
      await refreshDevServers();

      return result;
    },
    [refreshDevServers]
  );

  const stopDevServer = useCallback(
    async (folderId: string): Promise<void> => {
      const response = await fetch(`/api/dev-servers/${folderId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to stop dev server");
      }

      // Remove from state
      setDevServers((prev) => {
        const next = new Map(prev);
        next.delete(folderId);
        return next;
      });
    },
    []
  );

  const restartDevServer = useCallback(
    async (folderId: string): Promise<StartDevServerResponse> => {
      const response = await fetch(`/api/dev-servers/${folderId}/restart`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to restart dev server");
      }

      const result: StartDevServerResponse = await response.json();

      // Update state
      setDevServers((prev) => {
        const next = new Map(prev);
        const existing = prev.get(folderId);
        next.set(folderId, {
          ...existing,
          sessionId: result.sessionId,
          folderId,
          folderName: existing?.folderName || "",
          port: result.port,
          status: result.status,
          proxyUrl: result.proxyUrl,
          health: null,
          isStarting: true,
        });
        return next;
      });

      // Refresh to get full state
      await refreshDevServers();

      return result;
    },
    [refreshDevServers]
  );

  const getDevServer = useCallback(
    (folderId: string): DevServerState | undefined => {
      return devServers.get(folderId);
    },
    [devServers]
  );

  const hasDevServer = useCallback(
    (folderId: string): boolean => {
      return devServers.has(folderId);
    },
    [devServers]
  );

  const getDevServerConfig = useCallback(
    async (folderId: string): Promise<DevServerConfig | null> => {
      try {
        const response = await fetch(`/api/dev-servers/${folderId}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.config || null;
      } catch {
        return null;
      }
    },
    []
  );

  const updateDevServerStatus = useCallback(
    (folderId: string, status: DevServerStatus): void => {
      setDevServers((prev) => {
        const existing = prev.get(folderId);
        if (!existing) return prev;

        const next = new Map(prev);
        next.set(folderId, {
          ...existing,
          status,
          isStarting: status === "starting",
        });
        return next;
      });
    },
    []
  );

  const value: DevServerContextValue = {
    devServers,
    loading,
    startDevServer,
    stopDevServer,
    restartDevServer,
    getDevServer,
    hasDevServer,
    getDevServerConfig,
    refreshDevServers,
    updateDevServerStatus,
  };

  return (
    <DevServerContext.Provider value={value}>
      {children}
    </DevServerContext.Provider>
  );
}

export function useDevServers(): DevServerContextValue {
  const context = useContext(DevServerContext);
  if (!context) {
    throw new Error("useDevServers must be used within a DevServerProvider");
  }
  return context;
}

/**
 * Hook for a specific folder's dev server
 */
export function useDevServer(folderId: string | null): {
  devServer: DevServerState | null;
  isRunning: boolean;
  isStarting: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
} {
  const { getDevServer, startDevServer, stopDevServer, restartDevServer } = useDevServers();

  const devServer = folderId ? getDevServer(folderId) ?? null : null;
  const isRunning = devServer?.status === "running";
  const isStarting = devServer?.status === "starting" || devServer?.isStarting === true;

  const start = useCallback(async () => {
    if (!folderId) return;
    await startDevServer(folderId);
  }, [folderId, startDevServer]);

  const stop = useCallback(async () => {
    if (!folderId) return;
    await stopDevServer(folderId);
  }, [folderId, stopDevServer]);

  const restart = useCallback(async () => {
    if (!folderId) return;
    await restartDevServer(folderId);
  }, [folderId, restartDevServer]);

  return {
    devServer,
    isRunning,
    isStarting,
    start,
    stop,
    restart,
  };
}
