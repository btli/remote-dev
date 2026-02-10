import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TerminalSessionDTO } from "@remote-dev/domain";

interface SessionState {
  sessions: TerminalSessionDTO[];
  activeSessionId: string | null;
  loading: boolean;
  error: Error | null;
}

interface SessionActions {
  // Queries
  getSession: (id: string) => TerminalSessionDTO | undefined;
  getActiveSessions: () => TerminalSessionDTO[];

  // Mutations
  setSessions: (sessions: TerminalSessionDTO[]) => void;
  addSession: (session: TerminalSessionDTO) => void;
  updateSession: (id: string, updates: Partial<TerminalSessionDTO>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;

  // Async actions (will be implemented with API client)
  fetchSessions: () => Promise<void>;
  createSession: (input: { name: string; terminalType?: string }) => Promise<TerminalSessionDTO>;
  closeSession: (id: string) => Promise<void>;
  suspendSession: (id: string) => Promise<void>;
  resumeSession: (id: string) => Promise<void>;
}

type SessionStore = SessionState & SessionActions;

/**
 * Session store using Zustand with persistence.
 * Manages terminal session state for the mobile app.
 */
export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      // Initial state
      sessions: [],
      activeSessionId: null,
      loading: false,
      error: null,

      // Queries
      getSession: (id) => get().sessions.find((s) => s.id === id),
      getActiveSessions: () => get().sessions.filter((s) => s.status === "active"),

      // Mutations
      setSessions: (sessions) => set({ sessions, error: null }),
      addSession: (session) =>
        set((state) => ({ sessions: [...state.sessions, session] })),
      updateSession: (id, updates) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        })),
      removeSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId:
            state.activeSessionId === id ? null : state.activeSessionId,
        })),
      setActiveSession: (id) => set({ activeSessionId: id }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      // Async actions - placeholder implementations
      // These will be connected to the API client
      fetchSessions: async () => {
        set({ loading: true, error: null });
        try {
          // TODO: Call API client
          // const sessions = await apiClient.getSessions();
          // set({ sessions, loading: false });

          // Temporary: simulate empty response
          set({ sessions: [], loading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to fetch sessions"),
            loading: false,
          });
        }
      },

      createSession: async (input) => {
        set({ loading: true, error: null });
        try {
          // TODO: Call API client
          // const session = await apiClient.createSession(input);
          // get().addSession(session);
          // return session;

          // Temporary: create mock session
          const session: TerminalSessionDTO = {
            id: crypto.randomUUID(),
            userId: "mock-user",
            name: input.name,
            tmuxSessionName: `rdv-${crypto.randomUUID()}`,
            projectPath: null,
            githubRepoId: null,
            worktreeBranch: null,
            folderId: null,
            profileId: null,
            terminalType: input.terminalType || "shell",
            agentProvider: null,
            agentExitState: null,
            agentExitCode: null,
            agentExitedAt: null,
            agentRestartCount: 0,
            typeMetadata: null,
            splitGroupId: null,
            splitOrder: 0,
            splitSize: 100,
            status: "active",
            tabOrder: get().sessions.length,
            lastActivityAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          get().addSession(session);
          set({ loading: false });
          return session;
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to create session"),
            loading: false,
          });
          throw error;
        }
      },

      closeSession: async (id) => {
        try {
          // TODO: Call API client
          // await apiClient.closeSession(id);
          get().removeSession(id);
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to close session"),
          });
          throw error;
        }
      },

      suspendSession: async (id) => {
        try {
          // TODO: Call API client
          // await apiClient.suspendSession(id);
          get().updateSession(id, { status: "suspended" });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to suspend session"),
          });
          throw error;
        }
      },

      resumeSession: async (id) => {
        try {
          // TODO: Call API client
          // await apiClient.resumeSession(id);
          get().updateSession(id, { status: "active" });
        } catch (error) {
          set({
            error: error instanceof Error ? error : new Error("Failed to resume session"),
          });
          throw error;
        }
      },
    }),
    {
      name: "session-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);
