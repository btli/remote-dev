"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  TerminalSession,
  SessionAction,
  SessionState,
  ClientCreateSessionInput,
  SessionStatus,
} from "@/types/session";
import { checkAuthResponse } from "@/lib/api-client";
import { useDebouncedRefresh } from "@/hooks/useDebouncedRefresh";
import type { AgentActivityStatus, SessionStatusIndicator, SessionProgress } from "@/types/terminal-type";
import { isTmuxBackedTerminalType } from "@/types/terminal-type";
import { useProjectTree } from "./ProjectTreeContext";

const ACTIVE_SESSION_STORAGE_KEY = "remote-dev:activeSessionId";
const VALID_ACTIVITY_STATUSES = new Set<AgentActivityStatus>(["running", "waiting", "idle", "error", "compacting", "ended"]);

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
  createSession: (input: ClientCreateSessionInput) => Promise<TerminalSession>;
  updateSession: (
    sessionId: string,
    updates: Partial<TerminalSession> & {
      /**
       * Shallow-merged into the stored typeMetadata JSON server-side. Use
       * this instead of sending a full `typeMetadata` replacement when a
       * plugin only wants to patch a single field (e.g. the issues plugin
       * persisting `selectedIssueNumber`).
       */
      typeMetadataPatch?: Record<string, unknown>;
    }
  ) => Promise<void>;
  closeSession: (sessionId: string, options?: CloseSessionOptions) => Promise<void>;
  suspendSession: (sessionId: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  reorderSessions: (sessionIds: string[]) => Promise<void>;
  refreshSessions: () => Promise<void>;
  /** Debounced refresh for event-driven updates (WebSocket broadcasts). */
  debouncedRefreshSessions: () => void;
  /** Local-only UI update — no API call. Use when the server already persisted the change. */
  patchSessionLocal: (sessionId: string, updates: Partial<TerminalSession>) => void;
  /** Agent activity statuses for real-time sidebar indicators */
  agentActivityStatuses: Record<string, AgentActivityStatus>;
  setAgentActivityStatus: (sessionId: string, status: AgentActivityStatus) => void;
  getAgentActivityStatus: (sessionId: string) => AgentActivityStatus;
  /** Per-session custom status indicators (e.g. agent-reported status text) */
  sessionStatusIndicators: Record<string, Record<string, SessionStatusIndicator>>;
  setSessionStatusIndicator: (sessionId: string, key: string, indicator: SessionStatusIndicator | null) => void;
  /** Per-session progress bars */
  sessionProgress: Record<string, SessionProgress>;
  setSessionProgress: (sessionId: string, progress: SessionProgress | null) => void;
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

  // Active project tree node is used to auto-scope new sessions when the
  // caller didn't pass an explicit projectId/folderId.
  const { activeNode } = useProjectTree();

  // Agent activity statuses (client-side only, not persisted)
  const [agentActivityStatuses, setAgentActivityStatuses] = useState<Record<string, AgentActivityStatus>>({});

  const setAgentActivityStatus = useCallback((sessionId: string, status: AgentActivityStatus) => {
    setAgentActivityStatuses((prev) => {
      if (prev[sessionId] === status) return prev;
      return { ...prev, [sessionId]: status };
    });
  }, []);

  const getAgentActivityStatus = useCallback((sessionId: string): AgentActivityStatus => {
    // If we have hook-reported status, use it
    const hookStatus = agentActivityStatuses[sessionId];
    if (hookStatus) return hookStatus;

    // Fallback: infer from session state (only for definitive states)
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session?.terminalType === "agent") {
      if (session.agentExitState === "exited" && session.agentExitCode != null && session.agentExitCode !== 0) {
        return "error";
      }
      if (session.agentExitState === "restarting") {
        return "running";
      }
      // Use persisted activity status from DB (survives page refresh)
      if (session.agentActivityStatus && VALID_ACTIVITY_STATUSES.has(session.agentActivityStatus as AgentActivityStatus)) {
        return session.agentActivityStatus as AgentActivityStatus;
      }
    }

    return "idle";
  }, [agentActivityStatuses, state.sessions]);

  // Per-session status indicators (client-side only, not persisted)
  const [sessionStatusIndicators, setSessionStatusIndicatorsState] = useState<Record<string, Record<string, SessionStatusIndicator>>>({});
  const [sessionProgress, setSessionProgressState] = useState<Record<string, SessionProgress>>({});

  const setSessionStatusIndicator = useCallback((sessionId: string, key: string, indicator: SessionStatusIndicator | null) => {
    setSessionStatusIndicatorsState(prev => {
      if (indicator === null) {
        if (!prev[sessionId]?.[key]) return prev;
        const next = { ...prev };
        const sessionIndicators = { ...next[sessionId] };
        delete sessionIndicators[key];
        if (Object.keys(sessionIndicators).length === 0) {
          delete next[sessionId];
        } else {
          next[sessionId] = sessionIndicators;
        }
        return next;
      }
      const existing = prev[sessionId]?.[key];
      const isUnchanged = existing?.value === indicator.value
        && existing?.icon === indicator.icon
        && existing?.color === indicator.color;
      if (isUnchanged) return prev;
      return { ...prev, [sessionId]: { ...(prev[sessionId] || {}), [key]: indicator } };
    });
  }, []);

  const setSessionProgress = useCallback((sessionId: string, progress: SessionProgress | null) => {
    setSessionProgressState(prev => {
      if (progress === null) {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }
      if (prev[sessionId]?.value === progress.value && prev[sessionId]?.label === progress.label) return prev;
      return { ...prev, [sessionId]: progress };
    });
  }, []);

  // Track initialization state with refs
  const hasRestoredSessionRef = useRef(false);
  const hasFetchedSessionsRef = useRef(false);
  const initialSessionsLengthRef = useRef(initialSessions.length);

  // Single-flight write queue for PATCH /api/sessions/:id. Rapid consecutive
  // calls to updateSession() from the same browser (e.g. the Issues plugin
  // writing selectedIssueNumber as the user clicks quickly between issues)
  // were racing on the server — writes could land out of order, leaving
  // stale metadata persisted. We serialize the network round-trips per
  // session id via a promise chain. Optimistic local merges still happen
  // synchronously so the UI stays responsive.
  //
  // `pendingWritesRef` holds the tail of the chain for each session.
  // `pendingCountRef` counts how many writes are queued per session so we
  // can skip server-response reconciliation for stale replies — otherwise
  // reconciling an older response would transiently stomp on the newer
  // optimistic state that a later queued patch has already applied.
  const pendingWritesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingCountRef = useRef<Map<string, number>>(new Map());

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
      if (checkAuthResponse(response)) return;
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      dispatch({ type: "LOAD_SESSIONS", sessions: data.sessions });
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  }, []);

  // Debounced refresh — coalesces rapid WebSocket events and auto-refreshes
  // on page visibility change (tab switch, wake from sleep).
  const debouncedRefreshSessions = useDebouncedRefresh(refreshSessions);

  // Fetch sessions on mount if none provided (once on mount)
  useEffect(() => {
    if (hasFetchedSessionsRef.current) return;
    if (initialSessionsLengthRef.current === 0) {
      hasFetchedSessionsRef.current = true;
      refreshSessions();
    }
  }, [refreshSessions]);

  const createSession = useCallback(
    async (input: ClientCreateSessionInput): Promise<TerminalSession> => {
      // Derive projectId from the active node when the caller didn't pass one.
      // Group nodes can't own sessions directly, so we only fill in for project nodes.
      let resolvedProjectId: string | null | undefined = input.projectId;
      if (!resolvedProjectId && activeNode?.type === "project") {
        resolvedProjectId = activeNode.id;
      }

      // Phase G0a: projectId is required (terminal_session.project_id NOT NULL).
      if (!resolvedProjectId) {
        throw new Error(
          "Cannot create a session without a project. Select or create a project first."
        );
      }

      const payload = {
        ...input,
        projectId: resolvedProjectId,
      };

      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (checkAuthResponse(response)) return undefined as unknown as TerminalSession;

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }

      const body = (await response.json()) as TerminalSession & {
        _reused?: boolean;
      };
      const { _reused, ...session } = body;
      // F2: when the server reused an existing scope-keyed session, the
      // session may already be in local state (e.g. previously loaded from
      // /api/sessions). Dispatching CREATE would append a duplicate row —
      // instead, upsert: UPDATE if it exists, CREATE if it doesn't. Also
      // auto-resume if the reused row was left suspended (the sidebar
      // hides/suppresses suspended rows for some terminal types).
      if (_reused && state.sessions.some((s) => s.id === session.id)) {
        dispatch({ type: "UPDATE", sessionId: session.id, updates: session });
        dispatch({ type: "SET_ACTIVE", sessionId: session.id });
      } else {
        dispatch({ type: "CREATE", session });
      }
      return session;
    },
    [activeNode, state.sessions]
  );

  const updateSession = useCallback(
    (
      sessionId: string,
      updates: Partial<TerminalSession> & {
        typeMetadataPatch?: Record<string, unknown>;
      }
    ): Promise<void> => {
      // Optimistic update — for a typeMetadataPatch we synthesize the
      // merged typeMetadata locally so the UI reflects the change before
      // the server round-trip completes. F3: mirror server-side null
      // semantics — `{ key: null }` deletes the key instead of storing a
      // null value, matching what the service does on commit.
      //
      // This merge runs synchronously (before the queued fetch) so rapid
      // calls still see responsive UI. Each successive call merges over
      // the previous optimistic state so the view always reflects the
      // latest intent.
      const { typeMetadataPatch, ...rest } = updates;
      const optimistic: Partial<TerminalSession> = { ...rest };
      if (typeMetadataPatch) {
        const existing =
          state.sessions.find((s) => s.id === sessionId)?.typeMetadata ?? {};
        const merged: Record<string, unknown> = { ...existing };
        for (const [key, value] of Object.entries(typeMetadataPatch)) {
          if (value === null) {
            delete merged[key];
          } else {
            merged[key] = value;
          }
        }
        optimistic.typeMetadata = merged;
      }
      dispatch({ type: "UPDATE", sessionId, updates: optimistic });

      // Bump the pending-write counter before enqueueing so that any
      // earlier-scheduled fetch response can detect newer writes are
      // coming and skip its reconciliation step.
      const nextCount = (pendingCountRef.current.get(sessionId) ?? 0) + 1;
      pendingCountRef.current.set(sessionId, nextCount);

      const runFetch = async (): Promise<void> => {
        try {
          const response = await fetch(`/api/sessions/${sessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });

          if (checkAuthResponse(response)) return;

          if (!response.ok) {
            // Rollback on error - refetch
            await refreshSessions();
            throw new Error("Failed to update session");
          }

          // F3: reconcile optimistic state with server truth. The PATCH
          // response carries the canonical session; if any concurrent
          // writes reshaped typeMetadata, this replaces our optimistic
          // guess with the authoritative value instead of trusting the
          // local merge forever.
          //
          // Race hardening: only apply the reconciliation if no newer
          // patch is still queued behind us for this session. Otherwise
          // an older server snapshot would transiently stomp on the
          // newer optimistic state. The final queued write will reconcile
          // with fresh server truth when it lands.
          try {
            const updated = (await response.json()) as TerminalSession;
            const remaining = pendingCountRef.current.get(sessionId) ?? 0;
            if (updated && updated.id === sessionId && remaining <= 1) {
              dispatch({ type: "UPDATE", sessionId, updates: updated });
            }
          } catch {
            // Non-JSON body is fine — the optimistic value stands.
          }
        } catch (error) {
          console.error("Error updating session:", error);
          throw error;
        } finally {
          const remaining = pendingCountRef.current.get(sessionId) ?? 0;
          if (remaining <= 1) {
            pendingCountRef.current.delete(sessionId);
          } else {
            pendingCountRef.current.set(sessionId, remaining - 1);
          }
        }
      };

      // Chain onto any in-flight write for this session so the server
      // sees patches in call order. We swallow the previous link's
      // rejection inside the chain (it was already surfaced to its own
      // caller) so a single failure doesn't poison the queue.
      const prev = pendingWritesRef.current.get(sessionId);
      const next: Promise<void> = prev
        ? prev.then(
            () => runFetch(),
            () => runFetch(),
          )
        : runFetch();

      // Track the tail; clean up only if no one chained onto us while we
      // were running.
      pendingWritesRef.current.set(sessionId, next);
      next.finally(() => {
        if (pendingWritesRef.current.get(sessionId) === next) {
          pendingWritesRef.current.delete(sessionId);
        }
      }).catch(() => {
        // finally()'s chained promise carries the original rejection; we
        // suppress it here so React doesn't see an unhandled rejection
        // for the tail-cleanup hop. Callers still observe `next` below.
      });

      return next;
    },
    [refreshSessions, state.sessions]
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

        if (checkAuthResponse(response)) return;

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

        if (checkAuthResponse(response)) return;

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

        if (checkAuthResponse(response)) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));

          // 410 means the tmux session is gone — but that only makes sense
          // for tmux-backed terminal types (shell/agent/loop). Non-tmux
          // singletons (settings, recordings, profiles, prefs, secrets,
          // trash, port-manager, issues, prs, file, browser, …) have no
          // PTY behind them, so a 410 for one of those is a server-side
          // bug (see ResumeSessionUseCase). Do **not** auto-delete those
          // tabs — deleting a non-tmux singleton kicks the user out of
          // their Settings / Recordings / Profiles pane unexpectedly.
          if (response.status === 410) {
            const session = state.sessions.find((s) => s.id === sessionId);
            const tmuxBacked = isTmuxBackedTerminalType(session?.terminalType);
            if (tmuxBacked) {
              console.warn(`Tmux session gone for ${sessionId}, auto-closing...`);
              dispatch({ type: "DELETE", sessionId });
              const deleteResponse = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
              if (checkAuthResponse(deleteResponse)) return;
              return; // Don't throw - session has been cleaned up
            }

            // Non-tmux session — refresh to recover the authoritative status
            // (reducer already flipped to "active" optimistically) and
            // surface the error to the caller so it can recover without
            // losing the tab.
            console.warn(
              `Resume returned 410 for non-tmux session (${sessionId}, type=${session?.terminalType ?? "unknown"}); keeping tab.`
            );
            await refreshSessions();
            throw new Error(
              errorData.error ||
                `Resume returned 410 for non-tmux session (${sessionId})`
            );
          }

          await refreshSessions();
          throw new Error(errorData.error || `Failed to resume session (${response.status})`);
        }
      } catch (error) {
        console.error("Error resuming session:", error);
        throw error;
      }
    },
    [refreshSessions, state.sessions]
  );

  const setActiveSession = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_ACTIVE", sessionId });
  }, []);

  const patchSessionLocal = useCallback((sessionId: string, updates: Partial<TerminalSession>) => {
    dispatch({ type: "UPDATE", sessionId, updates });
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

        if (checkAuthResponse(response)) return;

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
      debouncedRefreshSessions,
      patchSessionLocal,
      agentActivityStatuses,
      setAgentActivityStatus,
      getAgentActivityStatus,
      sessionStatusIndicators,
      setSessionStatusIndicator,
      sessionProgress,
      setSessionProgress,
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
      debouncedRefreshSessions,
      patchSessionLocal,
      agentActivityStatuses,
      setAgentActivityStatus,
      getAgentActivityStatus,
      sessionStatusIndicators,
      setSessionStatusIndicator,
      sessionProgress,
      setSessionProgress,
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
