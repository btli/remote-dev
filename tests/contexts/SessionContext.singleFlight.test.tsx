/**
 * SessionContext single-flight write queue (remote-dev-cvtz.1).
 *
 * Regression test: prior to this change, `updateSession({ typeMetadataPatch })`
 * was fire-and-forget. Two rapid calls could race on the server, landing in
 * reverse order and persisting stale metadata. The fix serializes PATCH
 * round-trips per session id so the server always sees writes in call
 * order, while keeping the optimistic local merge synchronous for UI
 * responsiveness.
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

type FetchMock = ReturnType<typeof vi.fn>;

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    userId: "u1",
    name: "session",
    projectPath: "/tmp",
    projectId: "p1",
    tmuxSessionName: "rdv-s1",
    status: "active",
    tabOrder: 0,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    terminalType: "settings",
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

describe("SessionContext updateSession — single-flight queue", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes rapid typeMetadataPatch writes in call order", async () => {
    const session = makeSession({
      typeMetadata: { a: 0 } as Record<string, unknown>,
    });

    // Track the order the server receives PATCH requests and let the test
    // control when each round-trip resolves. We intentionally resolve the
    // SECOND request first in wall-clock time — the fix must still send
    // them to the server in call order.
    const receivedBodies: Array<Record<string, unknown>> = [];
    const resolvers: Array<() => void> = [];

    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      receivedBodies.push(body);
      const callIndex = receivedBodies.length - 1;
      await new Promise<void>((resolve) => {
        resolvers[callIndex] = resolve;
      });
      const patch = body.typeMetadataPatch as Record<string, unknown>;
      const merged = { ...(session.typeMetadata as Record<string, unknown>) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      (session.typeMetadata as Record<string, unknown>) = merged;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...session, typeMetadata: { ...merged } }),
        headers: new Headers(),
      } as unknown as Response;
    });

    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrapperWithProjectTree([session]),
    });

    // Wait for provider to hydrate initial sessions.
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    // Fire two rapid patches, back-to-back, without awaiting.
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.updateSession("s1", {
        typeMetadataPatch: { a: 1 },
      });
      p2 = result.current.updateSession("s1", {
        typeMetadataPatch: { a: 2 },
      });
    });

    // Only the first request should have left the client — the second is
    // queued behind it.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(receivedBodies[0]).toMatchObject({ typeMetadataPatch: { a: 1 } });

    // Optimistic state already reflects the SECOND patch because the local
    // merge runs synchronously even while the fetch is queued.
    expect(
      (
        result.current.sessions.find((s) => s.id === "s1")
          ?.typeMetadata as Record<string, unknown>
      ).a,
    ).toBe(2);

    // Release request 1.
    await act(async () => {
      resolvers[0]();
      await p1;
    });

    // Now request 2 should have been dispatched — in order.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(receivedBodies[1]).toMatchObject({ typeMetadataPatch: { a: 2 } });

    // Release request 2 and let everything settle.
    await act(async () => {
      resolvers[1]();
      await p2;
    });

    // Final persisted value on the (mock) server reflects the last call.
    expect((session.typeMetadata as Record<string, unknown>).a).toBe(2);

    // Local state also reflects the latest write.
    expect(
      (
        result.current.sessions.find((s) => s.id === "s1")
          ?.typeMetadata as Record<string, unknown>
      ).a,
    ).toBe(2);
  });

  it("skips stale reconciliation when a newer patch is still queued", async () => {
    const session = makeSession({
      typeMetadata: { a: 0 } as Record<string, unknown>,
    });

    const resolvers: Array<(body: Record<string, unknown>) => void> = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const callIndex = resolvers.length;
      return new Promise<Response>((resolve) => {
        resolvers[callIndex] = (serverReturn) => {
          resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...session,
              typeMetadata: serverReturn,
            }),
            headers: new Headers(),
          } as unknown as Response);
        };
        // Keep the body around so the test can assert on order.
        (resolvers[callIndex] as unknown as { body: unknown }).body = body;
      });
    });

    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrapperWithProjectTree([session]),
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.updateSession("s1", {
        typeMetadataPatch: { a: 1 },
      });
      p2 = result.current.updateSession("s1", {
        typeMetadataPatch: { a: 2 },
      });
    });

    // Wait for first fetch to be in-flight.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Finish request 1 by returning a server snapshot of { a: 1 }. Because
    // patch 2 is still queued, the reconciliation must NOT overwrite the
    // optimistic { a: 2 } state.
    await act(async () => {
      resolvers[0]({ a: 1 });
      await p1;
    });

    expect(
      (
        result.current.sessions.find((s) => s.id === "s1")
          ?.typeMetadata as Record<string, unknown>
      ).a,
    ).toBe(2);

    // Request 2 should now be in flight — complete it with { a: 2 }.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvers[1]({ a: 2 });
      await p2;
    });

    expect(
      (
        result.current.sessions.find((s) => s.id === "s1")
          ?.typeMetadata as Record<string, unknown>
      ).a,
    ).toBe(2);
  });

  it("null patch values still delete keys in the optimistic merge", async () => {
    const session = makeSession({
      typeMetadata: { keep: "x", drop: "y" } as Record<string, unknown>,
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...session, typeMetadata: { keep: "x" } }),
      headers: new Headers(),
    } as unknown as Response);

    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrapperWithProjectTree([session]),
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.updateSession("s1", {
        typeMetadataPatch: { drop: null },
      });
    });

    const meta = result.current.sessions.find((s) => s.id === "s1")
      ?.typeMetadata as Record<string, unknown>;
    expect(meta).toEqual({ keep: "x" });
    expect("drop" in meta).toBe(false);
  });
});
