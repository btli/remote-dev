/**
 * MobileApp single-session integration tests (Phase 3 mobile redesign).
 *
 * Verifies:
 *   - When there's an active session, MobileApp renders MobileSessionView
 *     full-bleed and forces the bottom tab bar hidden.
 *   - Swipe-up from the bottom edge re-shows the bar (forceHidden flips
 *     to false).
 *   - When the user clears the active session, the Sessions list returns.
 *
 * Heavy children (MobileSessionView, SessionsTab) are stubbed so we
 * exercise only the orchestration logic in MobileApp.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

import type { TerminalSession } from "@/types/session";
import { MobileApp } from "@/components/mobile/MobileApp";
import {
  ProjectTreeContext,
  type ProjectTreeContextValue,
} from "@/contexts/ProjectTreeContext";

// Stub the heavy children. We assert wiring, not their internals.
vi.mock("@/components/mobile/sessions/SessionsTab", () => ({
  SessionsTab: () => <div data-testid="stub-sessions-tab">SessionsTab</div>,
}));

vi.mock("@/components/mobile/session/MobileSessionView", () => ({
  MobileSessionView: ({ session }: { session: TerminalSession }) => (
    <div data-testid="stub-mobile-session-view" data-session-id={session.id}>
      Session view for {session.name}
    </div>
  ),
}));

const sessionMockState = {
  sessions: [] as TerminalSession[],
  activeSessionId: null as string | null,
  loading: false,
  setActiveSession: vi.fn((id: string | null) => {
    sessionMockState.activeSessionId = id;
  }),
  suspendSession: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  refreshSessions: vi.fn().mockResolvedValue(undefined),
  getAgentActivityStatus: vi.fn().mockReturnValue("idle"),
};

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => sessionMockState,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

// Phase 6 wired auth gating into MobileApp; the Phase 3 single-session
// tests don't care about it, so stub useSession to "unauthenticated"
// (we pass a real `initialUser` below to bypass the lock screen) and
// stub useFirstRun to skip the welcome screen.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated", update: vi.fn() }),
}));
vi.mock("@/components/mobile/auth/useFirstRun", () => ({
  useFirstRun: () => ({
    isFirstRun: false,
    markSeen: vi.fn(),
    reset: vi.fn(),
  }),
}));

let matchMediaImpl: (query: string) => MediaQueryList;

beforeEach(() => {
  matchMediaImpl = (query: string) =>
    ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => matchMediaImpl(q)),
  });
  // Force the mobile viewport hook into mobile mode by simulating innerWidth.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });

  sessionMockState.sessions = [];
  sessionMockState.activeSessionId = null;
  sessionMockState.setActiveSession.mockClear();
  sessionMockState.suspendSession.mockClear();
  sessionMockState.closeSession.mockClear();
  sessionMockState.getAgentActivityStatus.mockClear();
  sessionMockState.getAgentActivityStatus.mockReturnValue("idle");
});

afterEach(() => cleanup());

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    userId: "u1",
    name: "demo-session",
    tmuxSessionName: "rdv-s1",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "p1",
    profileId: null,
    terminalType: "shell",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    scopeKey: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProjectTree(): ProjectTreeContextValue {
  return {
    groups: [],
    projects: [
      { id: "p1", name: "Alpha", groupId: null, isAutoCreated: false, sortOrder: 0, collapsed: false },
    ],
    isLoading: false,
    activeNode: null,
    getGroup: () => undefined,
    getProject: (id: string) =>
      id === "p1"
        ? { id: "p1", name: "Alpha", groupId: null, isAutoCreated: false, sortOrder: 0, collapsed: false }
        : undefined,
    getChildrenOfGroup: () => ({ groups: [], projects: [] }),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    moveGroup: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    moveProject: vi.fn(),
    setActiveNode: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as ProjectTreeContextValue;
}

function renderApp() {
  return render(
    <ProjectTreeContext.Provider value={makeProjectTree()}>
      <MobileApp
        isGitHubConnected={false}
        initialUser={{ email: "test@example.com", name: "Test" }}
      />
    </ProjectTreeContext.Provider>
  );
}

describe("MobileApp single-session view (Phase 3)", () => {
  it("renders SessionsTab when no active session is selected", () => {
    renderApp();
    expect(screen.getByTestId("stub-sessions-tab")).toBeTruthy();
    expect(screen.queryByTestId("stub-mobile-session-view")).toBeNull();
    // Tab bar visible (forceHidden=false): translate is 0.
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.getAttribute("data-state")).toBe("visible");
  });

  it("renders MobileSessionView and hides the tab bar when a session is active", () => {
    const session = makeSession();
    sessionMockState.sessions = [session];
    sessionMockState.activeSessionId = session.id;
    renderApp();
    expect(screen.getByTestId("stub-mobile-session-view")).toBeTruthy();
    expect(screen.queryByTestId("stub-sessions-tab")).toBeNull();
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.getAttribute("data-state")).toBe("hidden");
  });

  it("swipe-up from the bottom edge reveals the tab bar over an active session", () => {
    const session = makeSession();
    sessionMockState.sessions = [session];
    sessionMockState.activeSessionId = session.id;
    renderApp();
    const bar = screen.getByTestId("mobile-bottom-tab-bar");
    expect(bar.getAttribute("data-state")).toBe("hidden");

    // Synthesize a swipe-up that starts within the bottom-edge threshold
    // (24px from bottom) and crosses the vertical threshold (32px).
    // The hook is bound on `window`, so we dispatch native TouchEvents
    // there, happy-dom supports both Touch and TouchEvent.
    const innerHeight = window.innerHeight;
    const startY = innerHeight - 8; // within edge threshold
    const endY = innerHeight - 80; // crosses vertical threshold

    act(() => {
      const startTouch = new Touch({
        identifier: 1,
        target: window as unknown as EventTarget,
        clientX: 100,
        clientY: startY,
      });
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [startTouch],
          targetTouches: [startTouch],
          changedTouches: [startTouch],
          bubbles: true,
        })
      );
      const moveTouch = new Touch({
        identifier: 1,
        target: window as unknown as EventTarget,
        clientX: 100,
        clientY: endY,
      });
      window.dispatchEvent(
        new TouchEvent("touchmove", {
          touches: [moveTouch],
          targetTouches: [moveTouch],
          changedTouches: [moveTouch],
          bubbles: true,
        })
      );
      window.dispatchEvent(
        new TouchEvent("touchend", {
          touches: [],
          targetTouches: [],
          changedTouches: [],
          bubbles: true,
        })
      );
    });

    // After the swipe, MobileApp flips `tabBarRevealed` to true, which
    // makes `sessionOpen` false → the tab bar's forceHidden flips back.
    const barAfter = screen.getByTestId("mobile-bottom-tab-bar");
    expect(barAfter.getAttribute("data-state")).toBe("visible");
  });

  it("auto-collapses the revealed tab bar after the inactivity timeout", () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      sessionMockState.sessions = [session];
      sessionMockState.activeSessionId = session.id;
      renderApp();
      const bar = screen.getByTestId("mobile-bottom-tab-bar");
      expect(bar.getAttribute("data-state")).toBe("hidden");

      const innerHeight = window.innerHeight;
      const startY = innerHeight - 8;
      const endY = innerHeight - 80;

      act(() => {
        const startTouch = new Touch({
          identifier: 1,
          target: window as unknown as EventTarget,
          clientX: 100,
          clientY: startY,
        });
        window.dispatchEvent(
          new TouchEvent("touchstart", {
            touches: [startTouch],
            targetTouches: [startTouch],
            changedTouches: [startTouch],
            bubbles: true,
          })
        );
        const moveTouch = new Touch({
          identifier: 1,
          target: window as unknown as EventTarget,
          clientX: 100,
          clientY: endY,
        });
        window.dispatchEvent(
          new TouchEvent("touchmove", {
            touches: [moveTouch],
            targetTouches: [moveTouch],
            changedTouches: [moveTouch],
            bubbles: true,
          })
        );
        window.dispatchEvent(
          new TouchEvent("touchend", {
            touches: [],
            targetTouches: [],
            changedTouches: [],
            bubbles: true,
          })
        );
      });

      expect(
        screen.getByTestId("mobile-bottom-tab-bar").getAttribute("data-state")
      ).toBe("visible");

      // Advance past the auto-collapse timeout (3500ms — see MobileApp).
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(
        screen.getByTestId("mobile-bottom-tab-bar").getAttribute("data-state")
      ).toBe("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearing the active session returns the SessionsTab", () => {
    const session = makeSession();
    sessionMockState.sessions = [session];
    sessionMockState.activeSessionId = session.id;
    const { rerender } = renderApp();
    expect(screen.getByTestId("stub-mobile-session-view")).toBeTruthy();

    // Simulate user clearing the active session.
    sessionMockState.activeSessionId = null;
    rerender(
      <ProjectTreeContext.Provider value={makeProjectTree()}>
        <MobileApp
        isGitHubConnected={false}
        initialUser={{ email: "test@example.com", name: "Test" }}
      />
      </ProjectTreeContext.Provider>
    );
    expect(screen.queryByTestId("stub-mobile-session-view")).toBeNull();
    expect(screen.getByTestId("stub-sessions-tab")).toBeTruthy();
  });
});
