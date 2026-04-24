/**
 * SessionContext resume 410 handling (remote-dev-nv4e).
 *
 * Regression test: before this fix, any 410 from
 * `POST /api/sessions/:id/resume` triggered an immediate `DELETE` of the
 * session client-side (see SessionContext.tsx `resumeSession`). That
 * works fine for tmux-backed sessions (shell/agent/loop) — the tmux
 * session really is gone and there's nothing to salvage. But for non-
 * tmux singletons (settings, recordings, profiles, prefs, secrets, …)
 * a 410 meant the Settings/Recordings/Profiles tab got yanked out from
 * under the user as soon as they clicked back on it.
 *
 * The fix: only auto-delete on 410 when the session's `terminalType` is
 * tmux-backed. Otherwise, refresh and surface the error so the tab
 * stays put. The underlying server-side bug that produced the 410 is
 * fixed in `ResumeSessionUseCase` (see its test file) — this test is
 * defense-in-depth so future server regressions don't destroy user state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  SessionProvider,
  useSessionContext,
} from "@/contexts/SessionContext";
import {
  ProjectTreeContext,
  type ProjectTreeContextValue,
} from "@/contexts/ProjectTreeContext";
import type { TerminalSession } from "@/types/session";
import type { TerminalType } from "@/types/terminal-type";

type FetchMock = ReturnType<typeof vi.fn>;

function makeSession(
  id: string,
  terminalType: TerminalType,
  overrides: Partial<TerminalSession> = {}
): TerminalSession {
  return {
    id,
    userId: "u1",
    name: `session-${id}`,
    projectPath: "/tmp",
    projectId: "p1",
    tmuxSessionName: `rdv-${id}`,
    status: "suspended",
    tabOrder: 0,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    terminalType,
    typeMetadata: {},
    ...overrides,
  } as unknown as TerminalSession;
}

function wrapperWithProjectTree(initial: TerminalSession[]) {
  const treeValue: ProjectTreeContextValue = {
    groups: [],
    projects: [],
    isLoading: false,
    activeNode: null,
    getGroup: () => undefined,
    getProject: () => undefined,
    getChildrenOfGroup: () => ({ groups: [], projects: [] }),
    createGroup: async () => ({
      id: "",
      name: "",
      parentGroupId: null,
      collapsed: false,
      sortOrder: 0,
    }),
    updateGroup: async () => undefined,
    deleteGroup: async () => undefined,
    moveGroup: async () => undefined,
    createProject: async () => ({
      id: "",
      name: "",
      groupId: null,
      isAutoCreated: false,
      sortOrder: 0,
      collapsed: false,
    }),
    updateProject: async () => undefined,
    deleteProject: async () => undefined,
    moveProject: async () => undefined,
    setActiveNode: async () => undefined,
    refresh: async () => undefined,
  } as unknown as ProjectTreeContextValue;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ProjectTreeContext.Provider value={treeValue}>
        <SessionProvider initialSessions={initial}>{children}</SessionProvider>
      </ProjectTreeContext.Provider>
    );
  }
  return Wrapper;
}

describe("SessionContext resumeSession — 410 handling by terminal type", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT auto-delete a non-tmux session (settings) on 410", async () => {
    const session = makeSession("s-settings", "settings");

    // /api/sessions/:id/resume returns 410. The old code would then fire
    // a DELETE; the new code must not.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (
        typeof url === "string" &&
        url === `/api/sessions/${session.id}/resume` &&
        init?.method === "POST"
      ) {
        return {
          ok: false,
          status: 410,
          json: async () => ({ error: "Tmux session no longer exists" }),
          headers: new Headers(),
        } as unknown as Response;
      }
      // GET /api/sessions (refreshSessions) — return the (suspended)
      // session as-is so the provider doesn't crash.
      if (typeof url === "string" && url.startsWith("/api/sessions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessions: [session] }),
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)} ${init?.method}`);
    });

    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrapperWithProjectTree([session]),
    });

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      // The client must reject (we don't want silent no-ops) but we don't
      // care about the exact message — the server error text may leak
      // through. The important assertion is the NO-DELETE check below.
      await expect(result.current.resumeSession(session.id)).rejects.toThrow();
    });

    // Verify no DELETE was ever dispatched for this session.
    const deleteCalls = fetchMock.mock.calls.filter(([url, init]) => {
      return (
        typeof url === "string" &&
        url === `/api/sessions/${session.id}` &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(deleteCalls).toHaveLength(0);

    // The tab is still present in state — the user's Settings pane is safe.
    expect(
      result.current.sessions.find((s) => s.id === session.id)
    ).toBeDefined();
  });

  it("DOES auto-delete a tmux-backed session (shell) on 410", async () => {
    const session = makeSession("s-shell", "shell");
    let deleteIssued = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (
        typeof url === "string" &&
        url === `/api/sessions/${session.id}/resume` &&
        init?.method === "POST"
      ) {
        return {
          ok: false,
          status: 410,
          json: async () => ({ error: "Tmux session no longer exists" }),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (
        typeof url === "string" &&
        url === `/api/sessions/${session.id}` &&
        init?.method === "DELETE"
      ) {
        deleteIssued = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (typeof url === "string" && url.startsWith("/api/sessions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessions: [] }),
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${String(url)} ${init?.method}`);
    });

    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrapperWithProjectTree([session]),
    });

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      // resumeSession resolves without throwing in the tmux-gone branch
      // because the tab has been "cleaned up".
      await result.current.resumeSession(session.id);
    });

    expect(deleteIssued).toBe(true);
    // Session is removed from local state.
    expect(
      result.current.sessions.find((s) => s.id === session.id)
    ).toBeUndefined();
  });

  it.each([
    "settings",
    "recordings",
    "profiles",
    "port-manager",
    "trash",
    "project-prefs",
    "group-prefs",
    "secrets",
  ] as const)(
    "does not delete a '%s' session on 410",
    async (terminalType) => {
      const session = makeSession(`s-${terminalType}`, terminalType);

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url === `/api/sessions/${session.id}/resume` &&
          init?.method === "POST"
        ) {
          return {
            ok: false,
            status: 410,
            json: async () => ({ error: "gone" }),
            headers: new Headers(),
          } as unknown as Response;
        }
        if (typeof url === "string" && url.startsWith("/api/sessions")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sessions: [session] }),
            headers: new Headers(),
          } as unknown as Response;
        }
        throw new Error(`Unexpected fetch: ${String(url)} ${init?.method}`);
      });

      const { result } = renderHook(() => useSessionContext(), {
        wrapper: wrapperWithProjectTree([session]),
      });

      await waitFor(() => expect(result.current.sessions).toHaveLength(1));

      await act(async () => {
        await expect(result.current.resumeSession(session.id)).rejects.toThrow();
      });

      const deleteCalls = fetchMock.mock.calls.filter(([url, init]) => {
        return (
          typeof url === "string" &&
          url === `/api/sessions/${session.id}` &&
          (init as RequestInit | undefined)?.method === "DELETE"
        );
      });
      expect(deleteCalls).toHaveLength(0);
    }
  );
});
