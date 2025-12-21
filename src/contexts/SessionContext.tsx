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
  TerminalSession,
  SessionAction,
  SessionState,
  CreateSessionInput,
  SessionStatus,
} from "@/types/session";

interface SessionContextValue extends SessionState {
  createSession: (input: CreateSessionInput) => Promise<TerminalSession>;
  updateSession: (sessionId: string, updates: Partial<TerminalSession>) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  suspendSession: (sessionId: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  reorderSessions: (sessionIds: string[]) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "LOAD_SESSIONS":
      return {
        ...state,
        sessions: action.sessions,
        loading: false,
        error: null,
        // Set active to first session if none selected
        activeSessionId:
          state.activeSessionId && action.sessions.find((s) => s.id === state.activeSessionId)
            ? state.activeSessionId
            : action.sessions.filter((s) => s.status === "active")[0]?.id ?? null,
      };

    case "CREATE":
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeSessionId: action.session.id,
      };

    case "UPDATE":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, ...action.updates } : s
        ),
      };

    case "DELETE": {
      const filteredSessions = state.sessions.filter((s) => s.id !== action.sessionId);
      const activeSessions = filteredSessions.filter((s) => s.status === "active");
      return {
        ...state,
        sessions: filteredSessions,
        activeSessionId:
          state.activeSessionId === action.sessionId
            ? activeSessions[0]?.id ?? null
            : state.activeSessionId,
      };
    }

    case "SET_ACTIVE":
      return {
        ...state,
        activeSessionId: action.sessionId,
      };

    case "REORDER":
      // Reorder sessions based on provided order
      const orderedSessions = action.sessionIds
        .map((id) => state.sessions.find((s) => s.id === id))
        .filter((s): s is TerminalSession => s !== undefined);

      // Keep any sessions not in the reorder list at the end
      const remainingSessions = state.sessions.filter(
        (s) => !action.sessionIds.includes(s.id)
      );

      return {
        ...state,
        sessions: [...orderedSessions, ...remainingSessions],
      };

    default:
      return state;
  }
}

interface SessionProviderProps {
  children: ReactNode;
  initialSessions?: TerminalSession[];
}

export function SessionProvider({
  children,
  initialSessions = [],
}: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, {
    sessions: initialSessions,
    activeSessionId: initialSessions.filter((s) => s.status === "active")[0]?.id ?? null,
    loading: false,
    error: null,
  });

  // Fetch sessions on mount if none provided
  useEffect(() => {
    if (initialSessions.length === 0) {
      refreshSessions();
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions?status=active");
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      dispatch({ type: "LOAD_SESSIONS", sessions: data.sessions });
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  }, []);

  const createSession = useCallback(
    async (input: CreateSessionInput): Promise<TerminalSession> => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }

      const session = await response.json();
      dispatch({ type: "CREATE", session });
      return session;
    },
    []
  );

  const updateSession = useCallback(
    async (sessionId: string, updates: Partial<TerminalSession>) => {
      // Optimistic update
      dispatch({ type: "UPDATE", sessionId, updates });

      try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          // Rollback on error - refetch
          await refreshSessions();
          throw new Error("Failed to update session");
        }
      } catch (error) {
        console.error("Error updating session:", error);
        throw error;
      }
    },
    [refreshSessions]
  );

  const closeSession = useCallback(
    async (sessionId: string) => {
      // FIX: Store previous active session to restore on error
      const previousActiveSessionId = state.activeSessionId;

      // Optimistic update
      dispatch({ type: "DELETE", sessionId });

      try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          // Rollback on error - refetch and restore active session
          await refreshSessions();
          // Restore the previous active session if it still exists
          if (previousActiveSessionId && previousActiveSessionId !== sessionId) {
            dispatch({ type: "SET_ACTIVE", sessionId: previousActiveSessionId });
          }
          throw new Error("Failed to close session");
        }
      } catch (error) {
        console.error("Error closing session:", error);
        throw error;
      }
    },
    [refreshSessions, state.activeSessionId]
  );

  const suspendSession = useCallback(
    async (sessionId: string) => {
      dispatch({
        type: "UPDATE",
        sessionId,
        updates: { status: "suspended" as SessionStatus },
      });

      try {
        const response = await fetch(`/api/sessions/${sessionId}/suspend`, {
          method: "POST",
        });

        if (!response.ok) {
          await refreshSessions();
          throw new Error("Failed to suspend session");
        }
      } catch (error) {
        console.error("Error suspending session:", error);
        throw error;
      }
    },
    [refreshSessions]
  );

  const resumeSession = useCallback(
    async (sessionId: string) => {
      dispatch({
        type: "UPDATE",
        sessionId,
        updates: { status: "active" as SessionStatus },
      });

      try {
        const response = await fetch(`/api/sessions/${sessionId}/resume`, {
          method: "POST",
        });

        if (!response.ok) {
          await refreshSessions();
          throw new Error("Failed to resume session");
        }
      } catch (error) {
        console.error("Error resuming session:", error);
        throw error;
      }
    },
    [refreshSessions]
  );

  const setActiveSession = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_ACTIVE", sessionId });
  }, []);

  const reorderSessions = useCallback(
    async (sessionIds: string[]) => {
      // Optimistic update
      dispatch({ type: "REORDER", sessionIds });

      try {
        const response = await fetch("/api/sessions/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionIds }),
        });

        if (!response.ok) {
          await refreshSessions();
          throw new Error("Failed to reorder sessions");
        }
      } catch (error) {
        console.error("Error reordering sessions:", error);
        throw error;
      }
    },
    [refreshSessions]
  );

  return (
    <SessionContext.Provider
      value={{
        ...state,
        createSession,
        updateSession,
        closeSession,
        suspendSession,
        resumeSession,
        setActiveSession,
        reorderSessions,
        refreshSessions,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within a SessionProvider");
  }
  return context;
}
