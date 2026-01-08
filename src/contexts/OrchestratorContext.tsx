"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { Orchestrator } from "@/domain/entities/Orchestrator";
import type { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";

interface OrchestratorState {
  orchestrators: Orchestrator[];
  insights: Map<string, OrchestratorInsight[]>; // orchestratorId -> insights
  unresolvedInsightCount: number;
  isLoading: boolean;
  error: string | null;
}

interface OrchestratorContextValue extends OrchestratorState {
  // Orchestrator operations
  createOrchestrator: (params: {
    sessionId: string;
    type: "master" | "sub_orchestrator";
    folderId?: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }) => Promise<void>;
  pauseOrchestrator: (orchestratorId: string) => Promise<void>;
  resumeOrchestrator: (orchestratorId: string) => Promise<void>;
  deleteOrchestrator: (orchestratorId: string) => Promise<void>;

  // Insight operations
  fetchInsights: (orchestratorId: string) => Promise<void>;
  resolveInsight: (insightId: string) => Promise<void>;

  // Utility
  getMasterOrchestrator: () => Orchestrator | null;
  getOrchestratorForFolder: (folderId: string) => Orchestrator | null;
  refreshOrchestrators: () => Promise<void>;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrchestratorState>({
    orchestrators: [],
    insights: new Map(),
    unresolvedInsightCount: 0,
    isLoading: false,
    error: null,
  });

  // Use ref to track orchestrators for the polling interval
  // This prevents the interval from being recreated on every orchestrator change
  const orchestratorsRef = useRef<Orchestrator[]>([]);

  // Fetch orchestrators
  const refreshOrchestrators = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch("/api/orchestrators");
      if (!response.ok) {
        throw new Error("Failed to fetch orchestrators");
      }

      const data = await response.json();
      const orchestrators = data.orchestrators || [];

      // Update ref for polling interval
      orchestratorsRef.current = orchestrators;

      setState((prev) => ({
        ...prev,
        orchestrators,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Unknown error",
        isLoading: false,
      }));
    }
  }, []);

  // Create orchestrator
  const createOrchestrator = useCallback(async (params: {
    sessionId: string;
    type: "master" | "sub_orchestrator";
    folderId?: string;
    customInstructions?: string;
    monitoringInterval?: number;
    stallThreshold?: number;
    autoIntervention?: boolean;
  }) => {
    const response = await fetch("/api/orchestrators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create orchestrator");
    }

    await refreshOrchestrators();
  }, [refreshOrchestrators]);

  // Pause orchestrator
  const pauseOrchestrator = useCallback(async (orchestratorId: string) => {
    const response = await fetch(`/api/orchestrators/${orchestratorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });

    if (!response.ok) {
      throw new Error("Failed to pause orchestrator");
    }

    await refreshOrchestrators();
  }, [refreshOrchestrators]);

  // Resume orchestrator
  const resumeOrchestrator = useCallback(async (orchestratorId: string) => {
    const response = await fetch(`/api/orchestrators/${orchestratorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });

    if (!response.ok) {
      throw new Error("Failed to resume orchestrator");
    }

    await refreshOrchestrators();
  }, [refreshOrchestrators]);

  // Delete orchestrator
  const deleteOrchestrator = useCallback(async (orchestratorId: string) => {
    const response = await fetch(`/api/orchestrators/${orchestratorId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete orchestrator");
    }

    await refreshOrchestrators();
  }, [refreshOrchestrators]);

  // Fetch insights for an orchestrator
  const fetchInsights = useCallback(async (orchestratorId: string) => {
    const response = await fetch(`/api/orchestrators/${orchestratorId}/insights?resolved=false`);

    if (!response.ok) {
      throw new Error("Failed to fetch insights");
    }

    const data = await response.json();

    setState((prev) => {
      const newInsights = new Map(prev.insights);
      newInsights.set(orchestratorId, data.insights || []);

      // Calculate total unresolved count
      let totalUnresolved = 0;
      newInsights.forEach((insights) => {
        totalUnresolved += insights.filter((i: OrchestratorInsight) => !i.resolved).length;
      });

      return {
        ...prev,
        insights: newInsights,
        unresolvedInsightCount: totalUnresolved,
      };
    });
  }, []);

  // Resolve an insight
  const resolveInsight = useCallback(async (insightId: string) => {
    // Find which orchestrator this insight belongs to
    let targetOrchestratorId: string | null = null;
    state.insights.forEach((insights, orchestratorId) => {
      if (insights.some((i) => i.id === insightId)) {
        targetOrchestratorId = orchestratorId;
      }
    });

    if (!targetOrchestratorId) {
      throw new Error("Insight not found");
    }

    // In a real implementation, we'd have a resolve endpoint
    // For now, just refetch insights
    await fetchInsights(targetOrchestratorId);
  }, [state.insights, fetchInsights]);

  // Get master orchestrator
  const getMasterOrchestrator = useCallback(() => {
    return state.orchestrators.find((o) => o.type === "master") || null;
  }, [state.orchestrators]);

  // Get orchestrator for a folder
  const getOrchestratorForFolder = useCallback((folderId: string) => {
    return state.orchestrators.find(
      (o) => o.type === "sub_orchestrator" && o.scopeId === folderId
    ) || null;
  }, [state.orchestrators]);

  // Initial load
  useEffect(() => {
    refreshOrchestrators();
  }, [refreshOrchestrators]);

  // Poll for insights every 30 seconds
  // Use ref to avoid recreating interval when orchestrators change
  useEffect(() => {
    const interval = setInterval(() => {
      // Use ref to get current orchestrators without causing interval recreation
      orchestratorsRef.current.forEach((orc) => {
        fetchInsights(orc.id).catch(console.error);
      });
    }, 30000);

    // Cleanup function runs only on unmount
    return () => clearInterval(interval);
  }, [fetchInsights]); // Only depend on fetchInsights (stable)

  return (
    <OrchestratorContext.Provider
      value={{
        ...state,
        createOrchestrator,
        pauseOrchestrator,
        resumeOrchestrator,
        deleteOrchestrator,
        fetchInsights,
        resolveInsight,
        getMasterOrchestrator,
        getOrchestratorForFolder,
        refreshOrchestrators,
      }}
    >
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOrchestratorContext() {
  const context = useContext(OrchestratorContext);
  if (!context) {
    throw new Error("useOrchestratorContext must be used within OrchestratorProvider");
  }
  return context;
}
