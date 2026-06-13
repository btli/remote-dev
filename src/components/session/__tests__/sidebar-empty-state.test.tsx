/**
 * Sidebar expanded-mode empty-state tests (P1: tree hidden with zero sessions).
 *
 * The expanded sidebar used to gate the project/group tree behind
 * `activeSessions.length === 0`, rendering the "No sessions" quick-start
 * INSTEAD of <ProjectTreeSidebar> whenever there were no open terminal
 * sessions. That hid every project and group on freshly-migrated instances
 * (terminal sessions never migrate) and for any user who closed all sessions.
 *
 * These tests verify the tree now renders whenever the user has any projects
 * OR groups OR active sessions, and the bare quick-start only shows when the
 * instance is truly empty for the user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TerminalSession } from "@/types/session";

// Override the global PortContext mock from tests/setup.ts so Sidebar's call
// to `activePorts.size` works. We don't need a real provider tree for this
// component — every context it reads is mocked below.
vi.mock("@/contexts/PortContext", () => ({
  usePortContext: () => ({
    allocations: [],
    activePorts: new Set<number>(),
  }),
  usePortContextOptional: () => null,
  PortProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/contexts/ProfileContext", () => ({
  useProfileContext: () => ({ profileCount: 0 }),
}));

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    getNodePreferences: () => null,
  }),
}));

vi.mock("@/contexts/SessionMCPContext", () => ({
  useSessionMCP: () => ({ mcpSupported: false }),
  useSessionMCPAutoLoad: () => undefined,
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    getAgentActivityStatus: () => "idle",
  }),
}));

// Drive the project/group counts per test. Sidebar reads these (same source
// ProjectTreeSidebar consumes) to decide between the tree and the empty state.
let mockGroups: Array<{ id: string }> = [];
let mockProjects: Array<{ id: string }> = [];
vi.mock("@/contexts/ProjectTreeContext", () => ({
  useProjectTree: () => ({ groups: mockGroups, projects: mockProjects }),
}));

// ProjectTreeSidebar is heavy (consumes many contexts). Stub it out so we can
// simply assert presence/absence of the tree without mocking the world.
vi.mock("../ProjectTreeSidebar", () => ({
  ProjectTreeSidebar: () => <div data-testid="project-tree-sidebar" />,
}));

// FilesSection / MCPServersSection are conditionally rendered; stubbing keeps
// the test focused on the body branch under test.
vi.mock("../FilesSection", () => ({
  FilesSection: () => null,
}));

vi.mock("@/components/mcp", () => ({
  MCPServersSection: () => null,
}));

import { Sidebar } from "../Sidebar";

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  const now = new Date();
  return {
    id: "session-1",
    userId: "user-1",
    name: "My Shell",
    tmuxSessionName: "rdv-session-1",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "project-1",
    profileId: null,
    terminalType: "shell" as TerminalSession["terminalType"],
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
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function renderExpandedSidebar(opts: { sessions?: TerminalSession[] } = {}) {
  return render(
    <Sidebar
      sessions={opts.sessions ?? []}
      activeSessionId={null}
      activeProjectId={null}
      collapsed={false}
      onCollapsedChange={vi.fn()}
      projectHasRepo={() => false}
      getFolderRepoStats={() => null}
      onSessionClick={vi.fn()}
      onSessionClose={vi.fn()}
      onSessionRename={vi.fn()}
      onSessionTogglePin={vi.fn()}
      onSessionMove={vi.fn()}
      onSessionReorder={vi.fn()}
      onNewSession={vi.fn()}
      onQuickNewSession={vi.fn()}
      onNewAgent={vi.fn()}
      onNewAgentWithProvider={vi.fn()}
      onOpenAgentSettings={vi.fn()}
      onProjectSettings={vi.fn()}
      onProjectNewSession={vi.fn()}
      onProjectNewAgent={vi.fn()}
      onProjectNewAgentWithProvider={vi.fn()}
      onProjectResumeClaudeSession={vi.fn()}
      onProjectAdvancedSession={vi.fn()}
      onProjectNewWorktree={vi.fn()}
      onProjectNewSshSession={vi.fn()}
      onProjectOpenSshSettings={vi.fn()}
      onProjectOpenSecrets={vi.fn()}
      onNewSshSession={vi.fn()}
      onOpenSshSettings={vi.fn()}
      trashCount={0}
      onTrashOpen={vi.fn()}
    />
  );
}

describe("Sidebar expanded empty state (project tree visibility)", () => {
  beforeEach(() => {
    cleanup();
    mockGroups = [];
    mockProjects = [];
  });

  it("renders the project tree when projects exist but there are no active sessions", () => {
    mockProjects = [{ id: "p1" }];
    renderExpandedSidebar({ sessions: [] });
    expect(screen.getByTestId("project-tree-sidebar")).toBeInTheDocument();
    expect(screen.queryByText(/No sessions/i)).toBeNull();
  });

  it("renders the project tree when only groups exist and there are no active sessions", () => {
    mockGroups = [{ id: "g1" }];
    renderExpandedSidebar({ sessions: [] });
    expect(screen.getByTestId("project-tree-sidebar")).toBeInTheDocument();
    expect(screen.queryByText(/No sessions/i)).toBeNull();
  });

  it("renders the project tree when active sessions exist", () => {
    // Counts are empty; an active session alone should still surface the tree.
    renderExpandedSidebar({ sessions: [makeSession()] });
    expect(screen.getByTestId("project-tree-sidebar")).toBeInTheDocument();
    expect(screen.queryByText(/No sessions/i)).toBeNull();
  });

  it("shows the quick-start empty state only when truly empty", () => {
    renderExpandedSidebar({ sessions: [] });
    // No sessions AND no projects AND no groups → the bare quick-start.
    expect(screen.getByText(/No sessions/i)).toBeInTheDocument();
    expect(screen.queryByTestId("project-tree-sidebar")).toBeNull();
    // The create affordances must remain available in the empty state.
    expect(
      screen.getByRole("button", { name: /New Session/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Advanced options/i)).toBeInTheDocument();
  });
});
