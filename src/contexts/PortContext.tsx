"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  PortAllocationWithFolder,
  DetectedFramework,
  DetectedRuntime,
  PortStatus,
  PortMonitoringConfig,
  PortContextValue,
  ProxyablePort,
  ProxyablePortsResponse,
} from "@/types/port";

// ============================================================================
// Context
// ============================================================================

import { apiFetch, prefixApiPath } from "@/lib/api-fetch";

const PortContext = createContext<PortContextValue | null>(null);

interface PortProviderProps {
  children: ReactNode;
}

// Default monitoring configuration
const DEFAULT_MONITORING_CONFIG: PortMonitoringConfig = {
  enabled: true,
  intervalMs: 30000, // 30 seconds
  lastCheck: null,
};

export function PortProvider({ children }: PortProviderProps) {
  // State
  const [allocations, setAllocations] = useState<PortAllocationWithFolder[]>([]);
  const [livePorts, setLivePorts] = useState<ProxyablePort[]>([]);
  const [activePorts, setActivePorts] = useState<Set<number>>(new Set());
  const [frameworks, setFrameworks] = useState<Map<string, DetectedFramework[]>>(
    new Map()
  );
  const [runtimes, setRuntimes] = useState<Map<string, DetectedRuntime>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monitoring, setMonitoring] = useState<PortMonitoringConfig>(
    DEFAULT_MONITORING_CONFIG
  );

  // Refs for interval management
  const monitoringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================================
  // Port Allocation Management
  // ============================================================================

  /**
   * Refresh all port allocations from the server
   */
  const refreshAllocations = useCallback(async () => {
    try {
      const response = await apiFetch("/api/ports", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - expected during initial load
          return;
        }
        throw new Error("Failed to fetch port allocations");
      }

      const data: { allocations?: Array<Omit<PortAllocationWithFolder, 'createdAt'> & { createdAt: string }> } = await response.json();
      const allocs: PortAllocationWithFolder[] = (data.allocations || []).map(
        (a) => ({
          ...a,
          createdAt: new Date(a.createdAt),
        })
      );

      setAllocations(allocs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ports");
    }
  }, []);

  /**
   * Refresh the live proxyable-ports set from the A4 seam.
   *
   * This is the authoritative source of "what is actually listening / claimed"
   * for this instance. We mirror the listening subset into `activePorts` so the
   * existing `isPortActive(port)` query reflects real runtime state without a
   * second polling mechanism.
   */
  const refreshLivePorts = useCallback(async () => {
    try {
      const response = await apiFetch("/api/ports/proxyable", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - expected during initial load
          return;
        }
        throw new Error("Failed to fetch proxyable ports");
      }

      const data: ProxyablePortsResponse = await response.json();
      const ports = data.ports ?? [];

      setLivePorts(ports);
    } catch (err) {
      // Non-fatal: keep prior live data. Surface only if nothing else has.
      console.error("Live port refresh failed:", err);
    }
  }, []);

  // ============================================================================
  // Framework Detection
  // ============================================================================

  /**
   * Detect frameworks for a folder
   */
  const detectFrameworks = useCallback(
    async (
      folderId: string,
      workingDirectory: string | null
    ): Promise<DetectedFramework[]> => {
      if (!workingDirectory) {
        return [];
      }

      try {
        const response = await apiFetch("/api/ports/detect-frameworks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ workingDirectory }),
        });

        if (!response.ok) {
          throw new Error("Failed to detect frameworks");
        }

        const data = await response.json();
        const detected = data.frameworks || [];

        // Cache the result
        setFrameworks((prev) => {
          const next = new Map(prev);
          next.set(folderId, detected);
          return next;
        });

        return detected;
      } catch (err) {
        console.error("Framework detection failed:", err);
        return [];
      }
    },
    []
  );

  /**
   * Detect runtime for a folder
   */
  const detectRuntime = useCallback(
    async (
      folderId: string,
      workingDirectory: string | null
    ): Promise<DetectedRuntime> => {
      const unknown: DetectedRuntime = { id: "unknown", name: "Unknown" };

      if (!workingDirectory) {
        return unknown;
      }

      try {
        const response = await apiFetch("/api/ports/detect-runtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ workingDirectory }),
        });

        if (!response.ok) {
          throw new Error("Failed to detect runtime");
        }

        const data = await response.json();
        const runtime = data.runtime || unknown;

        // Cache the result
        setRuntimes((prev) => {
          const next = new Map(prev);
          next.set(folderId, runtime);
          return next;
        });

        return runtime;
      } catch (err) {
        console.error("Runtime detection failed:", err);
        return unknown;
      }
    },
    []
  );

  // ============================================================================
  // Port Status Checking
  // ============================================================================

  /**
   * Check which ports are currently listening.
   *
   * Two complementary signals feed the active set (see `isPortActive`):
   *  - `/api/ports/status` probes the *allocated* ports specifically, so
   *    declared-but-unclaimed ports still get a live status.
   *  - `refreshLivePorts` pulls the instance-wide proxyable universe (the A4
   *    seam), which also covers listening ports that have no allocation row.
   *
   * Both are refreshed together here so the single monitoring tick keeps the
   * whole picture fresh without a second independent timer.
   */
  const checkPortsNow = useCallback(async () => {
    // Always refresh the live proxyable set alongside the status probe.
    const liveRefresh = refreshLivePorts();

    const ports = allocations.map((a) => a.port);
    if (ports.length === 0) {
      setActivePorts(new Set());
      setMonitoring((prev) => ({
        ...prev,
        lastCheck: new Date(),
      }));
      await liveRefresh;
      return;
    }

    try {
      const response = await apiFetch("/api/ports/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ports }),
      });

      if (!response.ok) {
        throw new Error("Failed to check port status");
      }

      const data = await response.json();
      const statuses: PortStatus[] = data.ports || [];

      setActivePorts(
        new Set(statuses.filter((s) => s.isListening).map((s) => s.port))
      );
      setMonitoring((prev) => ({
        ...prev,
        lastCheck: new Date(),
      }));
    } catch (err) {
      console.error("Port status check failed:", err);
    }

    await liveRefresh;
  }, [allocations, refreshLivePorts]);

  // ============================================================================
  // Allocation Queries
  // ============================================================================

  /**
   * Get allocations for a specific folder
   */
  const getAllocationsForFolder = useCallback(
    (folderId: string): PortAllocationWithFolder[] => {
      return allocations.filter((a) => a.folderId === folderId);
    },
    [allocations]
  );

  /**
   * Check if a port is available (not allocated or allocated to same folder)
   */
  const isPortAvailable = useCallback(
    (port: number, folderId: string): boolean => {
      const existing = allocations.find((a) => a.port === port);
      return !existing || existing.folderId === folderId;
    },
    [allocations]
  );

  /**
   * Set of ports currently listening per the live proxyable seam. Merged with
   * `activePorts` (the allocated-port status probe) so a port counts as active
   * if EITHER signal observed it listening.
   */
  const liveListeningPorts = useMemo(
    () => new Set(livePorts.filter((p) => p.isListening).map((p) => p.port)),
    [livePorts]
  );

  /**
   * Check if a port is currently listening (union of the status probe and the
   * live proxyable seam).
   */
  const isPortActive = useCallback(
    (port: number): boolean => {
      return activePorts.has(port) || liveListeningPorts.has(port);
    },
    [activePorts, liveListeningPorts]
  );

  /**
   * Build the in-pod proxy URL for a port (B2 / remote-dev-kmrx).
   *
   * Returns the same-origin path served by the B1 proxy route:
   * `<basePath>/proxy/<port>/`. The TRAILING SLASH matters — the route injects
   * a `<base href="<basePath>/proxy/<port>/">` tag, so the proxied app's
   * relative asset URLs resolve correctly only when the document was loaded at
   * the slash-terminated path.
   *
   * Client-safety: we prefix with `prefixApiPath` (NOT `prefixPath` from
   * `@/lib/base-path`). `prefixPath` captures `BASE_PATH` at import time, which
   * is empty in the browser bundle (basePath is not baked in — spec NF-4).
   * `prefixApiPath` reads the SSR-injected runtime base path
   * (`window.__RDV_BASE_PATH__`), matching every other client URL-builder in the
   * app (e.g. the GitHub-link `window.location.href` redirects).
   *
   * Returns `null` only for an obviously-invalid port; the normal case always
   * returns a string so the "open" affordances light up for live ports.
   */
  const getProxyUrl = useCallback((port: number): string | null => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return prefixApiPath(`/proxy/${port}/`);
  }, []);

  // ============================================================================
  // Monitoring Control
  // ============================================================================

  /**
   * Toggle port monitoring
   */
  const toggleMonitoring = useCallback((enabled: boolean) => {
    setMonitoring((prev) => ({
      ...prev,
      enabled,
    }));
  }, []);

  // ============================================================================
  // Effects
  // ============================================================================

  // Initial load
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      await Promise.all([refreshAllocations(), refreshLivePorts()]);
      setLoading(false);
    };

    loadInitialData();
  }, [refreshAllocations, refreshLivePorts]);

  // Check ports when allocations change
  useEffect(() => {
    if (allocations.length > 0) {
      checkPortsNow();
    }
  }, [allocations, checkPortsNow]);

  // Monitoring interval
  useEffect(() => {
    // Clear existing interval
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = null;
    }

    // Start new interval if enabled. Runs even with zero allocations so the
    // live proxyable set (which can include unallocated listening ports) stays
    // fresh; `checkPortsNow` handles the empty-allocation case internally.
    if (monitoring.enabled) {
      monitoringIntervalRef.current = setInterval(() => {
        checkPortsNow();
      }, monitoring.intervalMs);
    }

    return () => {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current);
      }
    };
  }, [monitoring.enabled, monitoring.intervalMs, checkPortsNow]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue = useMemo<PortContextValue>(
    () => ({
      // State
      allocations,
      livePorts,
      activePorts,
      frameworks,
      runtimes,
      loading,
      error,
      monitoring,

      // Actions
      refreshAllocations,
      refreshLivePorts,
      getProxyUrl,
      detectFrameworks,
      detectRuntime,
      getAllocationsForFolder,
      isPortAvailable,
      isPortActive,
      toggleMonitoring,
      checkPortsNow,
    }),
    [
      allocations,
      livePorts,
      activePorts,
      frameworks,
      runtimes,
      loading,
      error,
      monitoring,
      refreshAllocations,
      refreshLivePorts,
      getProxyUrl,
      detectFrameworks,
      detectRuntime,
      getAllocationsForFolder,
      isPortAvailable,
      isPortActive,
      toggleMonitoring,
      checkPortsNow,
    ]
  );

  return (
    <PortContext.Provider value={contextValue}>{children}</PortContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function usePortContext(): PortContextValue {
  const context = useContext(PortContext);
  if (!context) {
    throw new Error("usePortContext must be used within a PortProvider");
  }
  return context;
}

/**
 * Optional hook that returns null if not in provider
 */
export function usePortContextOptional(): PortContextValue | null {
  return useContext(PortContext);
}
