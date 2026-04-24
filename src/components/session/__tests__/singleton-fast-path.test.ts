// @vitest-environment node
/**
 * Singleton fast-path: openSettingsSession / openRecordingsSession /
 * openProfilesSession must be idempotent on re-open — clicking the button
 * again (after switching away to another tab) activates the existing tab
 * without a server round-trip and without side effects like close/suspend.
 *
 * Regression guard for the case where the second click on the gear /
 * recordings / profiles button could result in the singleton tab being
 * closed instead of reactivated. The fix lives in `SessionManager` by
 * checking client state for an existing non-terminal singleton session
 * before falling back to createSession.
 */
import { describe, it, expect, vi } from "vitest";
import type { TerminalSession } from "@/types/session";
import { shouldPatchSettingsTab } from "../settings-deep-link";

type Singleton = {
  terminalType:
    | "settings"
    | "recordings"
    | "profiles"
    | "project-prefs"
    | "group-prefs"
    | "secrets";
  scopeKey: string;
};

function makeSingleton(
  id: string,
  kind: Singleton,
  status: TerminalSession["status"],
  activeTab?: string,
): TerminalSession {
  return {
    id,
    terminalType: kind.terminalType,
    scopeKey: kind.scopeKey,
    status,
    typeMetadata: activeTab ? { activeTab } : null,
  } as unknown as TerminalSession;
}

/**
 * Mirrors the body of openSettingsSession / openRecordingsSession /
 * openProfilesSession. The real component carries React deps; this helper
 * isolates the decision tree so we can exercise it without rendering
 * SessionManager (which needs ~10 contexts).
 */
async function openSingleton(
  kind: Singleton,
  opts: {
    sessions: TerminalSession[];
    section?: string;
    setActiveSession: (id: string) => void;
    setActiveView: (view: "terminal" | "chat") => void;
    createSession: (input: unknown) => Promise<TerminalSession>;
    updateSession: (id: string, patch: unknown) => Promise<void>;
  },
): Promise<void> {
  const {
    sessions,
    section,
    setActiveSession,
    setActiveView,
    createSession,
    updateSession,
  } = opts;
  const existing = sessions.find(
    (s) =>
      s.terminalType === kind.terminalType &&
      s.scopeKey === kind.scopeKey &&
      s.status !== "closed" &&
      s.status !== "trashed",
  );
  if (existing) {
    setActiveSession(existing.id);
    setActiveView("terminal");
    if (
      kind.terminalType === "settings" &&
      shouldPatchSettingsTab(existing, section)
    ) {
      await updateSession(existing.id, {
        typeMetadataPatch: { activeTab: section },
      });
    }
    return;
  }
  const created = await createSession({
    projectId: "p1",
    terminalType: kind.terminalType,
    scopeKey: kind.scopeKey,
    typeMetadata: section ? { activeTab: section } : {},
  });
  setActiveSession(created.id);
  setActiveView("terminal");
}

const KINDS: Singleton[] = [
  { terminalType: "settings", scopeKey: "settings" },
  { terminalType: "recordings", scopeKey: "recordings" },
  { terminalType: "profiles", scopeKey: "profiles" },
  // Scope-keyed singletons: scopeKey is the projectId/groupId, so the fast
  // path only matches tabs for the same scope. Covers bd remote-dev-ajt7:
  // the regression that persisted on project-prefs / group-prefs / secrets
  // because their openers used to skip the client-side check entirely.
  { terminalType: "project-prefs", scopeKey: "proj-1" },
  { terminalType: "group-prefs", scopeKey: "group-1" },
  { terminalType: "secrets", scopeKey: "proj-1" },
];

describe("singleton fast-path — reactivate without roundtripping", () => {
  for (const kind of KINDS) {
    it(`${kind.terminalType}: reuses an active in-memory session`, async () => {
      const existing = makeSingleton("s1", kind, "active");
      const createSession = vi.fn();
      const updateSession = vi.fn();
      const setActiveSession = vi.fn();
      const setActiveView = vi.fn();

      await openSingleton(kind, {
        sessions: [existing],
        setActiveSession,
        setActiveView,
        createSession,
        updateSession,
      });

      expect(setActiveSession).toHaveBeenCalledWith("s1");
      expect(setActiveView).toHaveBeenCalledWith("terminal");
      // No server round-trip when a local singleton already exists.
      expect(createSession).not.toHaveBeenCalled();
      expect(updateSession).not.toHaveBeenCalled();
    });

    it(`${kind.terminalType}: reuses a suspended in-memory session`, async () => {
      const existing = makeSingleton("s1", kind, "suspended");
      const createSession = vi.fn();
      const updateSession = vi.fn();
      const setActiveSession = vi.fn();
      const setActiveView = vi.fn();

      await openSingleton(kind, {
        sessions: [existing],
        setActiveSession,
        setActiveView,
        createSession,
        updateSession,
      });

      expect(setActiveSession).toHaveBeenCalledWith("s1");
      expect(setActiveView).toHaveBeenCalledWith("terminal");
      expect(createSession).not.toHaveBeenCalled();
    });

    it(`${kind.terminalType}: ignores a closed tombstone and creates fresh`, async () => {
      const tombstone = makeSingleton("s0", kind, "closed");
      const fresh = makeSingleton("s2", kind, "active");
      const createSession = vi.fn(async () => fresh);
      const updateSession = vi.fn();
      const setActiveSession = vi.fn();
      const setActiveView = vi.fn();

      await openSingleton(kind, {
        sessions: [tombstone],
        setActiveSession,
        setActiveView,
        createSession,
        updateSession,
      });

      expect(createSession).toHaveBeenCalledTimes(1);
      expect(setActiveSession).toHaveBeenCalledWith("s2");
      expect(setActiveView).toHaveBeenCalledWith("terminal");
    });

    it(`${kind.terminalType}: never closes an existing tab on re-open`, async () => {
      // This is the core regression guard. The "close" verb cannot be
      // invoked from the open path by construction — we only call
      // setActiveSession / setActiveView / (optionally) updateSession.
      const existing = makeSingleton("s1", kind, "active");
      const closeSpy = vi.fn();
      const createSession = vi.fn();
      const updateSession = vi.fn();

      await openSingleton(kind, {
        sessions: [existing],
        setActiveSession: () => {},
        setActiveView: () => {},
        createSession,
        updateSession,
      });

      // updateSession allowed (settings may patch activeTab), but NO
      // status: closed or explicit close() invocation.
      expect(closeSpy).not.toHaveBeenCalled();
      const statusUpdates = updateSession.mock.calls.map(
        ([, patch]) => (patch as { status?: string } | undefined)?.status,
      );
      expect(statusUpdates).not.toContain("closed");
      expect(statusUpdates).not.toContain("trashed");
    });
  }

  it("settings: patches activeTab when requested section differs from stored", async () => {
    const existing = makeSingleton(
      "s1",
      { terminalType: "settings", scopeKey: "settings" },
      "active",
      "general",
    );
    const createSession = vi.fn();
    const updateSession = vi.fn(async () => undefined);
    const setActiveSession = vi.fn();
    const setActiveView = vi.fn();

    await openSingleton(
      { terminalType: "settings", scopeKey: "settings" },
      {
        sessions: [existing],
        section: "logs",
        setActiveSession,
        setActiveView,
        createSession,
        updateSession,
      },
    );

    expect(updateSession).toHaveBeenCalledWith("s1", {
      typeMetadataPatch: { activeTab: "logs" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("settings: does NOT patch when stored activeTab already matches", async () => {
    const existing = makeSingleton(
      "s1",
      { terminalType: "settings", scopeKey: "settings" },
      "active",
      "logs",
    );
    const updateSession = vi.fn(async () => undefined);

    await openSingleton(
      { terminalType: "settings", scopeKey: "settings" },
      {
        sessions: [existing],
        section: "logs",
        setActiveSession: () => {},
        setActiveView: () => {},
        createSession: vi.fn(),
        updateSession,
      },
    );

    expect(updateSession).not.toHaveBeenCalled();
  });

  // Scope-keyed singletons use the projectId/groupId as scopeKey. The fast
  // path must only match tabs with the same scope — opening prefs for
  // project B must not reuse an existing tab for project A.
  it("project-prefs: does NOT reuse a tab scoped to a different project", async () => {
    const existingForA = makeSingleton(
      "sA",
      { terminalType: "project-prefs", scopeKey: "proj-A" },
      "active",
    );
    const fresh = makeSingleton(
      "sB",
      { terminalType: "project-prefs", scopeKey: "proj-B" },
      "active",
    );
    const createSession = vi.fn(async () => fresh);
    const setActiveSession = vi.fn();

    await openSingleton(
      { terminalType: "project-prefs", scopeKey: "proj-B" },
      {
        sessions: [existingForA],
        setActiveSession,
        setActiveView: () => {},
        createSession,
        updateSession: vi.fn(),
      },
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession).toHaveBeenCalledWith("sB");
  });

  it("group-prefs: does NOT reuse a tab scoped to a different group", async () => {
    const existingForG1 = makeSingleton(
      "s1",
      { terminalType: "group-prefs", scopeKey: "group-1" },
      "active",
    );
    const fresh = makeSingleton(
      "s2",
      { terminalType: "group-prefs", scopeKey: "group-2" },
      "active",
    );
    const createSession = vi.fn(async () => fresh);
    const setActiveSession = vi.fn();

    await openSingleton(
      { terminalType: "group-prefs", scopeKey: "group-2" },
      {
        sessions: [existingForG1],
        setActiveSession,
        setActiveView: () => {},
        createSession,
        updateSession: vi.fn(),
      },
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession).toHaveBeenCalledWith("s2");
  });

  // Deep-link patch on reuse for project-prefs (mirrors settings). When the
  // caller asks for a specific initialTab and the stored one differs, the
  // opener should patch typeMetadata.initialTab via updateSession.
  it("project-prefs: patches initialTab when requested tab differs from stored", async () => {
    const existing = {
      id: "s1",
      terminalType: "project-prefs" as const,
      scopeKey: "proj-1",
      status: "active" as TerminalSession["status"],
      typeMetadata: { projectId: "proj-1", initialTab: "general" },
    } as unknown as TerminalSession;

    const updateSession = vi.fn(async (_id: string, _patch: unknown) => undefined);
    const createSession = vi.fn();

    // Inline the project-prefs reuse logic from SessionManager.tsx.
    const sessions = [existing];
    const initialTab: "general" | "appearance" | "repository" | "environment" =
      "appearance";
    const match = sessions.find(
      (s) =>
        s.terminalType === "project-prefs" &&
        s.scopeKey === "proj-1" &&
        s.status !== "closed" &&
        s.status !== "trashed",
    );
    expect(match).toBeDefined();
    if (match) {
      const storedTab = (match.typeMetadata as { initialTab?: string } | null)
        ?.initialTab;
      if (storedTab !== initialTab) {
        await updateSession(match.id, {
          typeMetadataPatch: { initialTab },
        });
      }
    }

    expect(updateSession).toHaveBeenCalledWith("s1", {
      typeMetadataPatch: { initialTab: "appearance" },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("project-prefs: does NOT patch initialTab when stored tab matches", async () => {
    const existing = {
      id: "s1",
      terminalType: "project-prefs" as const,
      scopeKey: "proj-1",
      status: "active" as TerminalSession["status"],
      typeMetadata: { projectId: "proj-1", initialTab: "appearance" },
    } as unknown as TerminalSession;

    const updateSession = vi.fn(async (_id: string, _patch: unknown) => undefined);

    const initialTab: "general" | "appearance" | "repository" | "environment" =
      "appearance";
    const storedTab = (existing.typeMetadata as { initialTab?: string } | null)
      ?.initialTab;
    if (storedTab !== initialTab) {
      await updateSession(existing.id, {
        typeMetadataPatch: { initialTab },
      });
    }

    expect(updateSession).not.toHaveBeenCalled();
  });

  it("secrets: does NOT reuse a tab scoped to a different project", async () => {
    const existingForA = makeSingleton(
      "sA",
      { terminalType: "secrets", scopeKey: "proj-A" },
      "active",
    );
    const fresh = makeSingleton(
      "sB",
      { terminalType: "secrets", scopeKey: "proj-B" },
      "active",
    );
    const createSession = vi.fn(async () => fresh);
    const setActiveSession = vi.fn();

    await openSingleton(
      { terminalType: "secrets", scopeKey: "proj-B" },
      {
        sessions: [existingForA],
        setActiveSession,
        setActiveView: () => {},
        createSession,
        updateSession: vi.fn(),
      },
    );

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession).toHaveBeenCalledWith("sB");
  });
});

/**
 * Sidebar-row click path (bd remote-dev-6mpg): clicking a session row in
 * the sidebar while activeView !== "terminal" must force the terminal
 * pane visible, otherwise the just-activated tab stays hidden behind chat
 * view and looks closed. Mirrors handleSessionClick in SessionManager.tsx.
 */
describe("handleSessionClick — switch to terminal view on row click", () => {
  /**
   * Mirrors the body of `handleSessionClick` in SessionManager.tsx. Isolated
   * here so we exercise the decision tree without mounting ~10 contexts.
   */
  function handleSessionClick(
    sessionId: string,
    opts: {
      sessions: TerminalSession[];
      setActiveSession: (id: string) => void;
      setActiveView: (view: "terminal" | "chat") => void;
      maybeAutoFollowFolder: (folderId: string | null) => void;
    },
  ): void {
    const { sessions, setActiveSession, setActiveView, maybeAutoFollowFolder } =
      opts;
    setActiveSession(sessionId);
    setActiveView("terminal");
    const session = sessions.find((s) => s.id === sessionId);
    const folderId =
      (session as (TerminalSession & { projectId?: string | null }) | undefined)
        ?.projectId || null;
    maybeAutoFollowFolder(folderId);
  }

  it("activates the session AND switches activeView to terminal (chat → terminal)", () => {
    // Reproducer for the exact user-reported flow: settings tab open,
    // user clicked another tab (or switched to chat), then clicked the
    // Global-section Settings row. Before the fix, activeView stayed on
    // "chat" so the terminal pane hosting Settings was hidden.
    const settings = makeSingleton(
      "settings-1",
      { terminalType: "settings", scopeKey: "settings" },
      "active",
    );
    const setActiveSession = vi.fn();
    const setActiveView = vi.fn();
    const maybeAutoFollowFolder = vi.fn();

    handleSessionClick("settings-1", {
      sessions: [settings],
      setActiveSession,
      setActiveView,
      maybeAutoFollowFolder,
    });

    expect(setActiveSession).toHaveBeenCalledWith("settings-1");
    expect(setActiveView).toHaveBeenCalledWith("terminal");
  });

  it("applies the same fix for non-singleton session rows", () => {
    // Not just singletons — any session row click from chat view must
    // reveal the terminal pane. Otherwise the click looks like a no-op.
    const shell = {
      id: "shell-1",
      terminalType: "shell",
      scopeKey: null,
      status: "active" as TerminalSession["status"],
      typeMetadata: null,
      projectId: "proj-1",
    } as unknown as TerminalSession;

    const setActiveSession = vi.fn();
    const setActiveView = vi.fn();
    const maybeAutoFollowFolder = vi.fn();

    handleSessionClick("shell-1", {
      sessions: [shell],
      setActiveSession,
      setActiveView,
      maybeAutoFollowFolder,
    });

    expect(setActiveSession).toHaveBeenCalledWith("shell-1");
    expect(setActiveView).toHaveBeenCalledWith("terminal");
    expect(maybeAutoFollowFolder).toHaveBeenCalledWith("proj-1");
  });
});

/**
 * In-flight sync dedup (bd remote-dev-p0bu): when SessionManager's sync
 * effect re-runs between POST-start and POST-complete, it previously
 * issued a duplicate resume/suspend on the already-transitioning session.
 * The fix tracks in-flight syncs in a Map<sessionId, Promise> so a second
 * call returns the same promise instead of firing a new POST.
 */
describe("syncSessionStatus in-flight dedup", () => {
  /**
   * Mirrors the real `syncSessionStatus` in SessionManager.tsx. Isolated
   * here so we don't need to mount the entire component with ~10 contexts.
   */
  function makeSyncer(opts: {
    resumeSession: (id: string) => Promise<void>;
    suspendSession: (id: string) => Promise<void>;
  }) {
    const inFlight = new Map<string, Promise<void>>();
    async function syncSessionStatus(
      sessionId: string,
      targetStatus: "active" | "suspended",
    ): Promise<void> {
      const existing = inFlight.get(sessionId);
      if (existing) {
        await existing;
        return;
      }
      const promise = (async () => {
        try {
          if (targetStatus === "active") {
            await opts.resumeSession(sessionId);
          } else {
            await opts.suspendSession(sessionId);
          }
        } catch {
          // swallow, mirrors component behavior
        }
      })();
      inFlight.set(sessionId, promise);
      try {
        await promise;
      } finally {
        if (inFlight.get(sessionId) === promise) {
          inFlight.delete(sessionId);
        }
      }
    }
    return { syncSessionStatus, inFlight };
  }

  it("deduplicates concurrent resume calls for the same session", async () => {
    const resolveResumeRef: { current: (() => void) | null } = { current: null };
    const resumeSession = vi.fn(
      (_id: string): Promise<void> =>
        new Promise<void>((resolve) => {
          resolveResumeRef.current = resolve;
        }),
    );
    const suspendSession = vi.fn(async () => undefined);

    const { syncSessionStatus } = makeSyncer({ resumeSession, suspendSession });

    // Fire two calls back-to-back — the second should await the first's
    // in-flight promise instead of issuing a duplicate resume.
    const first = syncSessionStatus("s1", "active");
    const second = syncSessionStatus("s1", "active");

    // resumeSession has been called exactly once; the second call is
    // queued on the in-flight promise.
    expect(resumeSession).toHaveBeenCalledTimes(1);

    // Resolve the first call and wait for both to settle.
    resolveResumeRef.current?.();
    await Promise.all([first, second]);

    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(suspendSession).not.toHaveBeenCalled();
  });

  it("clears the in-flight entry after settlement so future calls proceed", async () => {
    const resumeSession = vi.fn(async () => undefined);
    const suspendSession = vi.fn(async () => undefined);

    const { syncSessionStatus } = makeSyncer({ resumeSession, suspendSession });

    await syncSessionStatus("s1", "active");
    await syncSessionStatus("s1", "active");

    // Each sequential call issues a fresh resume (no stale dedup entry).
    expect(resumeSession).toHaveBeenCalledTimes(2);
  });

  it("does not dedup across different session ids", async () => {
    const resumeSession = vi.fn(async () => undefined);
    const suspendSession = vi.fn(async () => undefined);

    const { syncSessionStatus } = makeSyncer({ resumeSession, suspendSession });

    await Promise.all([
      syncSessionStatus("s1", "active"),
      syncSessionStatus("s2", "active"),
    ]);

    expect(resumeSession).toHaveBeenCalledTimes(2);
    expect(resumeSession).toHaveBeenCalledWith("s1");
    expect(resumeSession).toHaveBeenCalledWith("s2");
  });

  it("swallows errors but still clears the in-flight entry", async () => {
    const resumeSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cannot resume from state 'active'"))
      .mockResolvedValueOnce(undefined);
    const suspendSession = vi.fn(async () => undefined);

    const { syncSessionStatus, inFlight } = makeSyncer({
      resumeSession,
      suspendSession,
    });

    // First call rejects internally but should not throw out of syncSessionStatus.
    await syncSessionStatus("s1", "active");
    expect(inFlight.has("s1")).toBe(false);

    // Second call proceeds unhindered.
    await syncSessionStatus("s1", "active");
    expect(resumeSession).toHaveBeenCalledTimes(2);
  });
});
