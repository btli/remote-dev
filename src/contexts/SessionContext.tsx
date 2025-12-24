"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type {
  TerminalSession,
  SessionAction,
  SessionState,
  CreateSessionInput,
  SessionStatus,
} from "@/types/session";

const ACTIVE_SESSION_STORAGE_KEY = "remote-dev:activeSessionId";

/**
 * Get the saved active session ID from localStorage.
 * Returns null if not found or if running on server (SSR).
 */
function getSavedActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Save the active session ID to localStorage.
 */
function saveActiveSessionId(sessionId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors (e.g., quota exceeded, private browsing)
  }
}

interface CloseSessionOptions {
  deleteWorktree?: boolean;
}

interface SessionContextValue extends SessionState {
  createSession: (input: CreateSessionInput) => Promise<TerminalSession>;
  updateSession: (sessionId: string, updates: Partial<TerminalSession>) => Promise<void>;
  closeSession: (sessionId: string, options?: CloseSessionOptions) => Promise<void>;
  suspendSession: (sessionId: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  reorderSessions: (sessionIds: string[]) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Determine the best active session ID from available sessions.
 * Priority: saved localStorage ID > current state ID > first active session
 */
function determineActiveSessionId(
  sessions: TerminalSession[],
  currentActiveId: string | null
): string | null {
  const activeSessions = sessions.filter((s) => s.status !== "closed");
  if (activeSessions.length === 0) return null;

  // First, try the saved session from localStorage
  const savedId = getSavedActiveSessionId();
  if (savedId && activeSessions.find((s) => s.id === savedId)) {
    return savedId;
  }

  // Second, try the current active session if it still exists
  if (currentActiveId && activeSessions.find((s) => s.id === currentActiveId)) {
    return currentActiveId;
  }

  // Fall back to the first active session
  return activeSessions[0]?.id ?? null;
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "LOAD_SESSIONS": {
      const activeSessionId = determineActiveSessionId(action.sessions, state.activeSessionId);
      return {
        ...state,
        sessions: action.sessions,
        loading: false,
        error: null,
        activeSessionId,
      };
    }

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
      const activeSessions = filteredSessions.filter((s) => s.status !== "closed");
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
    // Initial active session is determined after hydration via useEffect
    // to properly access localStorage (SSR-safe)
    activeSessionId: initialSessions.filter((s) => s.status !== "closed")[0]?.id ?? null,
    loading: false,
    error: null,
  });

  // Track initialization state with refs
  const hasRestoredSessionRef = useRef(false);
  const hasFetchedSessionsRef = useRef(false);
  const initialSessionsLengthRef = useRef(initialSessions.length);

  // Restore active session from localStorage after hydration (once on mount)
  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;

    if (initialSessionsLengthRef.current > 0) {
      const restoredId = determineActiveSessionId(initialSessions, null);
      if (restoredId && restoredId !== state.activeSessionId) {
        dispatch({ type: "SET_ACTIVE", sessionId: restoredId });
      }
    }
  }, [initialSessions, state.activeSessionId]);

  // Persist activeSessionId to localStorage whenever it changes
  useEffect(() => {
    saveActiveSessionId(state.activeSessionId);
  }, [state.activeSessionId]);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions?status=active,suspended");
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      dispatch({ type: "LOAD_SESSIONS", sessions: data.sessions });
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  }, []);

  // Fetch sessions on mount if none provided (once on mount)
  useEffect(() => {
    if (hasFetchedSessionsRef.current) return;
    if (initialSessionsLengthRef.current === 0) {
      hasFetchedSessionsRef.current = true;
      refreshSessions();
    }
  }, [refreshSessions]);

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
    async (sessionId: string, options?: CloseSessionOptions) => {
      // FIX: Store previous active session to restore on error
      const previousActiveSessionId = state.activeSessionId;

      // Optimistic update
      dispatch({ type: "DELETE", sessionId });

      try {
        const url = options?.deleteWorktree
          ? `/api/sessions/${sessionId}?deleteWorktree=true`
          : `/api/sessions/${sessionId}`;
        const response = await fetch(url, {
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

  const contextValue = useMemo(
    () => ({
      ...state,
      createSession,
      updateSession,
      closeSession,
      suspendSession,
      resumeSession,
      setActiveSession,
      reorderSessions,
      refreshSessions,
    }),
    [
      state,
      createSession,
      updateSession,
      closeSession,
      suspendSession,
      resumeSession,
      setActiveSession,
      reorderSessions,
      refreshSessions,
    ]
  );

  return (
    <SessionContext.Provider value={contextValue}>
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
