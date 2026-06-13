/**
 * SessionsTab integration tests (Phase 2 mobile redesign).
 *
 * These tests render the real component with stubbed contexts and verify
 * the actual DOM produced — not just that the component "exists". Per the
 * brief's adversarial-review guidance, every test exercises a real path:
 * the chip opens the project sheet, the long-press dispatches into the
 * action sheet, the empty states render under matching conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TerminalSession } from "@/types/session";
import { SessionsTab } from "@/components/mobile/sessions/SessionsTab";
import {
  ProjectTreeContext,
  type GroupNode,
  type ProjectNode,
  type ProjectTreeContextValue,
} from "@/contexts/ProjectTreeContext";

// We mock SessionContext at the import level so SessionsTab pulls our
// stubbed values via `useSessionContext()`.
const sessionMockState = {
  sessions: [] as TerminalSession[],
  activeSessionId: null as string | null,
  loading: false,
  refreshSessions: vi.fn().mockResolvedValue(undefined),
  setActiveSession: vi.fn(),
  suspendSession: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
  getAgentActivityStatus: vi.fn().mockReturnValue("idle"),
  // [n6uc.5] Consumed by the jump-to-attention FAB derivation.
  sessionMetadata: {} as Record<string, unknown>,
  agentActivityStatuses: {} as Record<string, string>,
};

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => sessionMockState,
}));

// Sonner is imported directly by SessionsTab. Mock it so toast() calls don't
// throw because the Toaster isn't mounted.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
  }),
}));

// NewSessionWizard is heavy and pulls many other contexts. Stub it.
vi.mock("@/components/session/NewSessionWizard", () => ({
  NewSessionWizard: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="new-session-wizard-stub">
        <button type="button" onClick={onClose}>
          close-stub
        </button>
      </div>
    ) : null,
}));

function makeProjectTree(
  overrides: Partial<ProjectTreeContextValue> = {}
): ProjectTreeContextValue {
  const groups: GroupNode[] = overrides.groups ?? [];
  const projects: ProjectNode[] =
    overrides.projects ?? [
      { id: "p1", name: "Alpha", groupId: null, isAutoCreated: false, sortOrder: 0, collapsed: false },
      { id: "p2", name: "Bravo", groupId: null, isAutoCreated: false, sortOrder: 1, collapsed: false },
    ];
  return {
    groups,
    projects,
    isLoading: false,
    activeNode: null,
    getGroup: (id: string) => groups.find((g) => g.id === id),
    getProject: (id: string) => projects.find((p) => p.id === id),
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
    ...overrides,
  } as ProjectTreeContextValue;
}

function renderTab(
  treeOverrides: Partial<ProjectTreeContextValue> = {},
  isGitHubConnected = false
) {
  const tree = makeProjectTree(treeOverrides);
  const ui = render(
    <ProjectTreeContext.Provider value={tree}>
      <SessionsTab isGitHubConnected={isGitHubConnected} />
    </ProjectTreeContext.Provider>
  );
  return { tree, ...ui };
}

function makeSession(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    userId: "u1",
    name: "main",
    tmuxSessionName: "rdv-s1",
    projectPath: "/tmp/x",
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
    agentActivityStatusAt: null,
    typeMetadata: null,
    scopeKey: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: new Date(Date.now() - 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  sessionMockState.sessions = [];
  sessionMockState.activeSessionId = null;
  sessionMockState.loading = false;
  sessionMockState.getAgentActivityStatus = vi.fn().mockReturnValue("idle");
  sessionMockState.refreshSessions = vi.fn().mockResolvedValue(undefined);
  sessionMockState.suspendSession = vi.fn().mockResolvedValue(undefined);
  sessionMockState.resumeSession = vi.fn().mockResolvedValue(undefined);
  sessionMockState.closeSession = vi.fn().mockResolvedValue(undefined);
  sessionMockState.setActiveSession = vi.fn();

  // The new-session sheet (dynamically imported here) mounts ProfileProvider,
  // which fires `/api/profiles` + `/api/claude-pools` fetches on mount. Stub
  // global fetch so those resolve to empty payloads instead of hitting the
  // network (an unhandled rejection there would fail the whole run).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/claude-pools")) {
        return new Response(JSON.stringify({ pools: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/profiles")) {
        return new Response(
          JSON.stringify({ profiles: [], folderLinks: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
});

afterEach(() => cleanup());

describe("SessionsTab", () => {
  it("renders the project chip with the active project name", () => {
    renderTab({
      activeNode: { id: "p1", type: "project" },
    });
    const chip = screen.getByTestId("mobile-project-chip");
    expect(chip).toHaveTextContent("Alpha");
  });

  it("renders 'All projects' chip when no active node is set", () => {
    renderTab();
    const chip = screen.getByTestId("mobile-project-chip");
    expect(chip).toHaveTextContent("All projects");
  });

  it("opens the project tree sheet when the chip is tapped", async () => {
    const user = userEvent.setup();
    renderTab();
    expect(screen.queryByTestId("mobile-bottom-sheet")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("mobile-project-chip"));
    await waitFor(() => screen.getByTestId("mobile-bottom-sheet"));
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows the no-project empty state when no projects exist and no active node", () => {
    renderTab({ projects: [] });
    expect(screen.getByTestId("mobile-sessions-empty-noproject")).toHaveTextContent(
      /No project yet/
    );
  });

  it("shows the no-sessions empty state when a project is active but has no sessions", () => {
    renderTab({
      activeNode: { id: "p1", type: "project" },
    });
    expect(
      screen.getByTestId("mobile-sessions-empty-nosessions")
    ).toHaveTextContent(/No sessions in Alpha/);
  });

  it("renders session rows for sessions in the active project", () => {
    sessionMockState.sessions = [
      makeSession({ id: "s1", name: "main", projectId: "p1" }),
      makeSession({ id: "s2", name: "tests", projectId: "p1" }),
    ];
    renderTab({ activeNode: { id: "p1", type: "project" } });
    const list = screen.getByTestId("mobile-sessions-list");
    expect(within(list).getAllByTestId("mobile-session-row")).toHaveLength(2);
  });

  it("filters out sessions from other projects when a project is active", () => {
    sessionMockState.sessions = [
      makeSession({ id: "s1", name: "main", projectId: "p1" }),
      makeSession({ id: "s2", name: "main2", projectId: "p2" }),
    ];
    renderTab({ activeNode: { id: "p1", type: "project" } });
    const rows = screen.getAllByTestId("mobile-session-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataset.sessionId).toBe("s1");
  });

  it("places the active session first", () => {
    sessionMockState.sessions = [
      makeSession({ id: "s1", name: "older", projectId: "p1", lastActivityAt: new Date(Date.now() - 60_000) }),
      makeSession({ id: "s2", name: "active", projectId: "p1", lastActivityAt: new Date(Date.now() - 600_000) }),
    ];
    sessionMockState.activeSessionId = "s2";
    renderTab({ activeNode: { id: "p1", type: "project" } });
    const rows = screen.getAllByTestId("mobile-session-row");
    expect(rows[0]?.dataset.sessionId).toBe("s2");
  });

  it("dispatches suspend with undo toast when a row is swiped left past threshold", () => {
    const session = makeSession({ id: "s1", name: "swipe-target", projectId: "p1" });
    sessionMockState.sessions = [session];
    renderTab({ activeNode: { id: "p1", type: "project" } });
    const row = screen.getByTestId("mobile-session-row");
    // Swipe left: synthesise touchStart, touchMove (-120), touchEnd.
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
    fireEvent.touchEnd(row);
    expect(sessionMockState.suspendSession).toHaveBeenCalledWith("s1");
  });

  it("opens the action sheet on long-press", async () => {
    sessionMockState.sessions = [makeSession({ id: "s1", projectId: "p1" })];
    renderTab({ activeNode: { id: "p1", type: "project" } });
    const row = screen.getByTestId("mobile-session-row");
    // The hook listens to pointer/mouse/touch — mouseDown is the most
    // reliable one across happy-dom + RTL.
    fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
    await waitFor(
      () => screen.getByTestId("mobile-action-sheet-items"),
      { timeout: 1500 }
    );
    const items = screen.getByTestId("mobile-action-sheet-items");
    expect(within(items).getByText("Suspend")).toBeInTheDocument();
    expect(within(items).getByText("Close session")).toBeInTheDocument();
  });

  it("opens the new-session sheet when '+ New' is tapped", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByTestId("mobile-new-session-button"));
    expect(screen.getByTestId("new-session-wizard-stub")).toBeInTheDocument();
  });
});
