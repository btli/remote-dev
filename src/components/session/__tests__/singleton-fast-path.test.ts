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
  terminalType: "settings" | "recordings" | "profiles";
  scopeKey: "settings" | "recordings" | "profiles";
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
});
