"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  SessionScheduleWithSession,
  SessionScheduleWithCommands,
  CreateScheduleInput,
  UpdateScheduleInput,
  ScheduleCommandInput,
  ScheduleExecution,
  ScheduleState,
  ScheduleAction,
} from "@/types/schedule";

// =============================================================================
// Context State
// =============================================================================

const initialState: ScheduleState = {
  schedules: [],
  loading: false,
  error: null,
};

function scheduleReducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true, error: null };
    case "LOAD_SUCCESS":
      return { ...state, loading: false, schedules: action.schedules };
    case "LOAD_ERROR":
      return { ...state, loading: false, error: action.error };
    case "CREATE":
      return { ...state, schedules: [...state.schedules, action.schedule] };
    case "UPDATE":
      return {
        ...state,
        schedules: state.schedules.map((s) =>
          s.id === action.scheduleId ? { ...s, ...action.updates } : s
        ),
      };
    case "DELETE":
      return {
        ...state,
        schedules: state.schedules.filter((s) => s.id !== action.scheduleId),
      };
    case "TOGGLE_ENABLED":
      return {
        ...state,
        schedules: state.schedules.map((s) =>
          s.id === action.scheduleId ? { ...s, enabled: action.enabled } : s
        ),
      };
    default:
      return state;
  }
}

// =============================================================================
// Context Definition
// =============================================================================

interface ScheduleContextValue extends ScheduleState {
  /** Refresh schedules from server */
  refreshSchedules: () => Promise<void>;
  /** Create a new schedule */
  createSchedule: (input: CreateScheduleInput) => Promise<SessionScheduleWithCommands>;
  /** Update an existing schedule */
  updateSchedule: (
    scheduleId: string,
    updates: UpdateScheduleInput,
    commands?: ScheduleCommandInput[]
  ) => Promise<SessionScheduleWithCommands>;
  /** Delete a schedule */
  deleteSchedule: (scheduleId: string) => Promise<void>;
  /** Toggle schedule enabled state */
  toggleEnabled: (scheduleId: string, enabled: boolean) => Promise<void>;
  /** Execute a schedule immediately */
  executeNow: (scheduleId: string) => Promise<ScheduleExecution>;
  /** Get execution history for a schedule */
  getExecutionHistory: (scheduleId: string, limit?: number) => Promise<ScheduleExecution[]>;
  /** Get schedule with commands */
  getScheduleWithCommands: (scheduleId: string) => Promise<SessionScheduleWithCommands | null>;
  /** Get schedules for a specific session */
  getSchedulesForSession: (sessionId: string) => SessionScheduleWithSession[];
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface ScheduleProviderProps {
  children: ReactNode;
}

export function ScheduleProvider({ children }: ScheduleProviderProps) {
  const [state, dispatch] = useReducer(scheduleReducer, initialState);

  // Fetch all schedules on mount
  const refreshSchedules = useCallback(async () => {
    dispatch({ type: "LOAD_START" });
    try {
      const response = await fetch("/api/schedules");
      if (!response.ok) {
        throw new Error("Failed to load schedules");
      }
      const data = await response.json();
      dispatch({ type: "LOAD_SUCCESS", schedules: data.schedules || [] });
    } catch (error) {
      dispatch({
        type: "LOAD_ERROR",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, []);

  // Load schedules on mount
  useEffect(() => {
    refreshSchedules();
  }, [refreshSchedules]);

  // Create a new schedule
  const createSchedule = useCallback(
    async (input: CreateScheduleInput): Promise<SessionScheduleWithCommands> => {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create schedule");
      }

      const schedule = await response.json();

      // Add to state with session info (we'll need to refresh for full data)
      await refreshSchedules();

      return schedule;
    },
    [refreshSchedules]
  );

  // Update an existing schedule
  const updateSchedule = useCallback(
    async (
      scheduleId: string,
      updates: UpdateScheduleInput,
      commands?: ScheduleCommandInput[]
    ): Promise<SessionScheduleWithCommands> => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updates, commands }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update schedule");
      }

      const schedule = await response.json();

      dispatch({ type: "UPDATE", scheduleId, updates });

      return schedule;
    },
    []
  );

  // Delete a schedule
  const deleteSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    const response = await fetch(`/api/schedules/${scheduleId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to delete schedule");
    }

    dispatch({ type: "DELETE", scheduleId });
  }, []);

  // Toggle enabled state
  const toggleEnabled = useCallback(
    async (scheduleId: string, enabled: boolean): Promise<void> => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to toggle schedule");
      }

      dispatch({ type: "TOGGLE_ENABLED", scheduleId, enabled });
    },
    []
  );

  // Execute schedule immediately
  const executeNow = useCallback(
    async (scheduleId: string): Promise<ScheduleExecution> => {
      const response = await fetch(`/api/schedules/${scheduleId}/execute`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to execute schedule");
      }

      const data = await response.json();
      return data.execution;
    },
    []
  );

  // Get execution history
  const getExecutionHistory = useCallback(
    async (scheduleId: string, limit = 50): Promise<ScheduleExecution[]> => {
      const response = await fetch(
        `/api/schedules/${scheduleId}/executions?limit=${limit}`
      );

      if (!response.ok) {
        throw new Error("Failed to get execution history");
      }

      const data = await response.json();
      return data.executions || [];
    },
    []
  );

  // Get schedule with commands
  const getScheduleWithCommands = useCallback(
    async (scheduleId: string): Promise<SessionScheduleWithCommands | null> => {
      const response = await fetch(`/api/schedules/${scheduleId}`);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to get schedule");
      }

      return response.json();
    },
    []
  );

  // Get schedules for a specific session
  const getSchedulesForSession = useCallback(
    (sessionId: string): SessionScheduleWithSession[] => {
      return state.schedules.filter((s) => s.sessionId === sessionId);
    },
    [state.schedules]
  );

  const value: ScheduleContextValue = {
    ...state,
    refreshSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleEnabled,
    executeNow,
    getExecutionHistory,
    getScheduleWithCommands,
    getSchedulesForSession,
  };

  return (
    <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useScheduleContext(): ScheduleContextValue {
  const context = useContext(ScheduleContext);
  if (!context) {
    throw new Error("useScheduleContext must be used within ScheduleProvider");
  }
  return context;
}
