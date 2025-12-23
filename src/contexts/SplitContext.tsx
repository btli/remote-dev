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
  SplitDirection,
  SplitGroupWithSessions,
} from "@/types/split";

interface SplitContextValue {
  splits: SplitGroupWithSessions[];
  activePanes: Record<string, string>; // splitGroupId -> active sessionId
  loading: boolean;
  createSplit: (
    sourceSessionId: string,
    direction: SplitDirection,
    newSessionName?: string
  ) => Promise<SplitGroupWithSessions>;
  addToSplit: (
    splitGroupId: string,
    sessionId?: string,
    newSessionName?: string
  ) => Promise<SplitGroupWithSessions>;
  removeFromSplit: (sessionId: string) => Promise<void>;
  updateLayout: (
    splitGroupId: string,
    layout: Array<{ sessionId: string; size: number }>
  ) => Promise<void>;
  changeSplitDirection: (
    splitGroupId: string,
    direction: SplitDirection
  ) => Promise<void>;
  dissolveSplit: (splitGroupId: string) => Promise<void>;
  setActivePaneInSplit: (splitGroupId: string, sessionId: string) => void;
  getSplitForSession: (sessionId: string) => SplitGroupWithSessions | null;
  refreshSplits: () => Promise<void>;
}

const SplitContext = createContext<SplitContextValue | null>(null);

interface SplitProviderProps {
  children: ReactNode;
}

export function SplitProvider({ children }: SplitProviderProps) {
  const [splits, setSplits] = useState<SplitGroupWithSessions[]>([]);
  const [activePanes, setActivePanes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refreshSplits = useCallback(async () => {
    try {
      const response = await fetch("/api/splits");
      if (!response.ok) throw new Error("Failed to fetch splits");
      const data = await response.json();
      setSplits(data.splits || []);

      // Initialize active panes for each split (first session by default)
      const newActivePanes: Record<string, string> = {};
      for (const split of data.splits || []) {
        if (split.sessions.length > 0 && !activePanes[split.id]) {
          newActivePanes[split.id] = split.sessions[0].sessionId;
        }
      }
      setActivePanes((prev) => ({ ...prev, ...newActivePanes }));
    } catch (error) {
      console.error("Error fetching splits:", error);
    } finally {
      setLoading(false);
    }
  }, [activePanes]);

  // Fetch splits on mount
  useEffect(() => {
    refreshSplits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSplit = useCallback(
    async (
      sourceSessionId: string,
      direction: SplitDirection,
      newSessionName?: string
    ): Promise<SplitGroupWithSessions> => {
      const response = await fetch("/api/splits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSessionId, direction, newSessionName }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create split");
      }

      const split: SplitGroupWithSessions = await response.json();
      setSplits((prev) => [...prev, split]);

      // Set first session as active in this split
      if (split.sessions.length > 0) {
        setActivePanes((prev) => ({
          ...prev,
          [split.id]: split.sessions[0].sessionId,
        }));
      }

      return split;
    },
    []
  );

  const addToSplit = useCallback(
    async (
      splitGroupId: string,
      sessionId?: string,
      newSessionName?: string
    ): Promise<SplitGroupWithSessions> => {
      const response = await fetch(`/api/splits/${splitGroupId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, newSessionName }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add to split");
      }

      const split: SplitGroupWithSessions = await response.json();
      setSplits((prev) =>
        prev.map((s) => (s.id === splitGroupId ? split : s))
      );
      return split;
    },
    []
  );

  const removeFromSplit = useCallback(
    async (sessionId: string) => {
      // Find which split this session belongs to
      const split = splits.find((s) =>
        s.sessions.some((ss) => ss.sessionId === sessionId)
      );
      if (!split) return;

      // Optimistic update
      const updatedSessions = split.sessions.filter(
        (ss) => ss.sessionId !== sessionId
      );
      if (updatedSessions.length <= 1) {
        // Split will be dissolved
        setSplits((prev) => prev.filter((s) => s.id !== split.id));
        setActivePanes((prev) => {
          const next = { ...prev };
          delete next[split.id];
          return next;
        });
      } else {
        setSplits((prev) =>
          prev.map((s) =>
            s.id === split.id ? { ...s, sessions: updatedSessions } : s
          )
        );
      }

      try {
        const response = await fetch(
          `/api/splits/${split.id}/sessions?sessionId=${sessionId}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          await refreshSplits();
          throw new Error("Failed to remove from split");
        }
      } catch (error) {
        console.error("Error removing from split:", error);
        throw error;
      }
    },
    [splits, refreshSplits]
  );

  const updateLayout = useCallback(
    async (
      splitGroupId: string,
      layout: Array<{ sessionId: string; size: number }>
    ) => {
      // Optimistic update
      setSplits((prev) =>
        prev.map((s) =>
          s.id === splitGroupId
            ? {
                ...s,
                sessions: layout.map((l, i) => ({
                  sessionId: l.sessionId,
                  splitOrder: i,
                  splitSize: l.size,
                })),
              }
            : s
        )
      );

      try {
        const response = await fetch(`/api/splits/${splitGroupId}/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout }),
        });

        if (!response.ok) {
          await refreshSplits();
          throw new Error("Failed to update layout");
        }
      } catch (error) {
        console.error("Error updating layout:", error);
        throw error;
      }
    },
    [refreshSplits]
  );

  const changeSplitDirection = useCallback(
    async (splitGroupId: string, direction: SplitDirection) => {
      // Optimistic update
      setSplits((prev) =>
        prev.map((s) => (s.id === splitGroupId ? { ...s, direction } : s))
      );

      try {
        const response = await fetch(`/api/splits/${splitGroupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction }),
        });

        if (!response.ok) {
          await refreshSplits();
          throw new Error("Failed to change direction");
        }
      } catch (error) {
        console.error("Error changing direction:", error);
        throw error;
      }
    },
    [refreshSplits]
  );

  const dissolveSplit = useCallback(
    async (splitGroupId: string) => {
      // Optimistic update
      setSplits((prev) => prev.filter((s) => s.id !== splitGroupId));
      setActivePanes((prev) => {
        const next = { ...prev };
        delete next[splitGroupId];
        return next;
      });

      try {
        const response = await fetch(`/api/splits/${splitGroupId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          await refreshSplits();
          throw new Error("Failed to dissolve split");
        }
      } catch (error) {
        console.error("Error dissolving split:", error);
        throw error;
      }
    },
    [refreshSplits]
  );

  const setActivePaneInSplit = useCallback(
    (splitGroupId: string, sessionId: string) => {
      setActivePanes((prev) => ({ ...prev, [splitGroupId]: sessionId }));
    },
    []
  );

  const getSplitForSession = useCallback(
    (sessionId: string): SplitGroupWithSessions | null => {
      return (
        splits.find((s) =>
          s.sessions.some((ss) => ss.sessionId === sessionId)
        ) || null
      );
    },
    [splits]
  );

  return (
    <SplitContext.Provider
      value={{
        splits,
        activePanes,
        loading,
        createSplit,
        addToSplit,
        removeFromSplit,
        updateLayout,
        changeSplitDirection,
        dissolveSplit,
        setActivePaneInSplit,
        getSplitForSession,
        refreshSplits,
      }}
    >
      {children}
    </SplitContext.Provider>
  );
}

export function useSplitContext() {
  const context = useContext(SplitContext);
  if (!context) {
    throw new Error("useSplitContext must be used within a SplitProvider");
  }
  return context;
}
