"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { useSessionContext } from "@/contexts/SessionContext";

// =============================================================================
// Context State
// =============================================================================

import { apiFetch } from "@/lib/api-fetch";

/** Poll cadence for keeping schedule rows fresh while the tab is visible. */
const SCHEDULE_POLL_INTERVAL_MS = 60_000;

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
    case "LOAD_STALE":
      // A refetch resolved after a newer client mutation — keep the
      // optimistically-updated schedules, just clear the loading flag.
      return { ...state, loading: false };
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
  const { activeSessionId } = useSessionContext();

  // Monotonic mutation counter: a background refetch that started before the
  // latest client mutation would otherwise clobber the optimistic dispatch
  // with pre-mutation data (a visible revert for up to one poll interval).
  // Mutations bump the counter; a refetch whose fetch began at an older
  // counter value drops its payload.
  const mutationSeqRef = useRef(0);

  // Fetch all user schedules
  const refreshSchedules = useCallback(async () => {
    const seqAtStart = mutationSeqRef.current;
    dispatch({ type: "LOAD_START" });
    try {
      const response = await apiFetch("/api/schedules");
      if (!response.ok) {
        throw new Error("Failed to load schedules");
      }
      const data = await response.json();
      if (mutationSeqRef.current !== seqAtStart) {
        // A mutation landed while this fetch was in flight, so the response
        // predates it — drop it; the next refetch re-syncs.
        dispatch({ type: "LOAD_STALE" });
        return;
      }
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

  // Keep long-lived tabs fresh: schedules execute in the terminal server
  // process with no push channel into this context, so a tab left open
  // renders stale rows (e.g. "Overdue" for schedules that actually fired).
  // Refetch when the tab becomes visible and poll every 60s while visible.
  // (The status-control WebSocket only carries agent-activity /
  // session-metadata pushes; wiring schedule-execution events through it
  // would require terminal-server broadcast changes, so lightweight polling
  // is used instead.)
  useEffect(() => {
    const refetchIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshSchedules();
      }
    };

    document.addEventListener("visibilitychange", refetchIfVisible);
    const interval = setInterval(refetchIfVisible, SCHEDULE_POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", refetchIfVisible);
      clearInterval(interval);
    };
  }, [refreshSchedules]);

  // Create a new schedule
  const createSchedule = useCallback(
    async (input: CreateScheduleInput): Promise<SessionScheduleWithCommands> => {
      const response = await apiFetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create schedule");
      }

      const schedule = await response.json();

      // Bump the mutation counter so an in-flight background poll that
      // started before this create cannot clobber the refetch below with
      // pre-create data (the new row would vanish until the next poll).
      mutationSeqRef.current += 1;

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
      const response = await apiFetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updates, commands }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update schedule");
      }

      const schedule = await response.json();

      // Use the returned schedule data for state update (properly typed)
      mutationSeqRef.current += 1;
      dispatch({
        type: "UPDATE",
        scheduleId,
        updates: {
          name: schedule.name,
          scheduleType: schedule.scheduleType,
          cronExpression: schedule.cronExpression,
          scheduledAt: schedule.scheduledAt ? new Date(schedule.scheduledAt) : null,
          timezone: schedule.timezone,
          enabled: schedule.enabled,
          status: schedule.status,
          maxRetries: schedule.maxRetries,
          retryDelaySeconds: schedule.retryDelaySeconds,
          timeoutSeconds: schedule.timeoutSeconds,
          nextRunAt: schedule.nextRunAt ? new Date(schedule.nextRunAt) : null,
          updatedAt: schedule.updatedAt ? new Date(schedule.updatedAt) : new Date(),
        },
      });

      return schedule;
    },
    []
  );

  // Delete a schedule
  const deleteSchedule = useCallback(async (scheduleId: string): Promise<void> => {
    const response = await apiFetch(`/api/schedules/${scheduleId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to delete schedule");
    }

    mutationSeqRef.current += 1;
    dispatch({ type: "DELETE", scheduleId });
  }, []);

  // Toggle enabled state
  const toggleEnabled = useCallback(
    async (scheduleId: string, enabled: boolean): Promise<void> => {
      const response = await apiFetch(`/api/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to toggle schedule");
      }

      const schedule = await response.json();

      // Apply the server's returned row, not just the flipped flag: re-enable
      // resets a 'cancelled'/'missed' status to 'active' server-side, and a
      // bare enabled flip would keep rendering the stale terminal label until
      // the next poll.
      mutationSeqRef.current += 1;
      dispatch({
        type: "UPDATE",
        scheduleId,
        updates: {
          name: schedule.name,
          scheduleType: schedule.scheduleType,
          cronExpression: schedule.cronExpression,
          scheduledAt: schedule.scheduledAt ? new Date(schedule.scheduledAt) : null,
          timezone: schedule.timezone,
          enabled: schedule.enabled,
          status: schedule.status,
          maxRetries: schedule.maxRetries,
          retryDelaySeconds: schedule.retryDelaySeconds,
          timeoutSeconds: schedule.timeoutSeconds,
          nextRunAt: schedule.nextRunAt ? new Date(schedule.nextRunAt) : null,
          updatedAt: schedule.updatedAt ? new Date(schedule.updatedAt) : new Date(),
        },
      });
    },
    []
  );

  // Execute schedule immediately
  const executeNow = useCallback(
    async (scheduleId: string): Promise<ScheduleExecution> => {
      const response = await apiFetch(`/api/schedules/${scheduleId}/execute`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to execute schedule");
      }

      const data = await response.json();

      // Bump the mutation counter so an in-flight background poll that
      // started before this execution cannot clobber the refetch below with
      // pre-execution data (re-rendering "Overdue" until the next poll).
      mutationSeqRef.current += 1;

      // Refresh schedules to sync nextRunAt and status after execution
      await refreshSchedules();

      return data.execution;
    },
    [refreshSchedules]
  );

  // Get execution history
  const getExecutionHistory = useCallback(
    async (scheduleId: string, limit = 50): Promise<ScheduleExecution[]> => {
      const response = await apiFetch(
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
      const response = await apiFetch(`/api/schedules/${scheduleId}`);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to get schedule");
      }

      return response.json();
    },
    []
  );

  // Get schedules for a specific session (uses full list for badges/guards)
  const getSchedulesForSession = useCallback(
    (sessionId: string): SessionScheduleWithSession[] => {
      return state.schedules.filter((s) => s.sessionId === sessionId);
    },
    [state.schedules]
  );

  // Expose only active session's schedules for the right sidebar display
  const activeSessionSchedules = useMemo(
    () =>
      activeSessionId
        ? state.schedules.filter((s) => s.sessionId === activeSessionId)
        : [],
    [state.schedules, activeSessionId]
  );

  const value = useMemo<ScheduleContextValue>(
    () => ({
      ...state,
      // Override schedules with session-scoped list for consumers (TaskSidebar)
      schedules: activeSessionSchedules,
      refreshSchedules,
      createSchedule,
      updateSchedule,
      deleteSchedule,
      toggleEnabled,
      executeNow,
      getExecutionHistory,
      getScheduleWithCommands,
      getSchedulesForSession,
    }),
    [
      state,
      activeSessionSchedules,
      refreshSchedules,
      createSchedule,
      updateSchedule,
      deleteSchedule,
      toggleEnabled,
      executeNow,
      getExecutionHistory,
      getScheduleWithCommands,
      getSchedulesForSession,
    ]
  );

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
