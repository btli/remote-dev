/**
 * Sidebar collapsed-mode rail tests (remote-dev-t9f3).
 *
 * Verifies that when `collapsed=true` and sessions are present, the sidebar
 * still exposes session selection, the create dropdown, and footer actions —
 * before the fix this rail was effectively empty and unusable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Activity status defaults to "idle" but tests can override per-session via
// `setMockAgentStatus` to drive the running/waiting/error styling paths.
const mockAgentStatuses = new Map<string, string>();
function setMockAgentStatus(sessionId: string, status: string) {
  mockAgentStatuses.set(sessionId, status);
}
vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    getAgentActivityStatus: (sessionId: string) =>
      mockAgentStatuses.get(sessionId) ?? "idle",
  }),
}));

// ProjectTreeSidebar is heavy (consumes many contexts) and is never rendered
// in collapsed mode anyway. Stub it out so we don't have to mock the world.
vi.mock("../ProjectTreeSidebar", () => ({
  ProjectTreeSidebar: () => <div data-testid="project-tree-sidebar" />,
}));

// FilesSection / MCPServersSection are conditionally rendered; stubbing keeps
// the test focused on the rail.
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

interface RenderOpts {
  sessions?: TerminalSession[];
  activeSessionId?: string | null;
  trashCount?: number;
  onProfilesOpen?: (() => void) | undefined;
  onPortsOpen?: (() => void) | undefined;
  onSessionClick?: (id: string) => void;
  onTrashOpen?: () => void;
}

function renderCollapsedSidebar(opts: RenderOpts = {}) {
  const onSessionClick = opts.onSessionClick ?? vi.fn();
  const onTrashOpen = opts.onTrashOpen ?? vi.fn();
  // `null` keeps a callback's slot empty — distinct from "leave undefined".
  const profilesProp =
    opts.onProfilesOpen === undefined ? vi.fn() : opts.onProfilesOpen;
  const portsProp =
    opts.onPortsOpen === undefined ? vi.fn() : opts.onPortsOpen;
  const utils = render(
    <Sidebar
      sessions={opts.sessions ?? [makeSession()]}
      activeSessionId={opts.activeSessionId ?? null}
      activeProjectId={null}
      collapsed={true}
      onCollapsedChange={vi.fn()}
      projectHasRepo={() => false}
      getFolderRepoStats={() => null}
      onSessionClick={onSessionClick}
      onSessionClose={vi.fn()}
      onSessionRename={vi.fn()}
      onSessionTogglePin={vi.fn()}
      onSessionMove={vi.fn()}
      onSessionReorder={vi.fn()}
      onNewSession={vi.fn()}
      onQuickNewSession={vi.fn()}
      onNewAgent={vi.fn()}
      onProjectSettings={vi.fn()}
      onProjectNewSession={vi.fn()}
      onProjectNewAgent={vi.fn()}
      onProjectResumeClaudeSession={vi.fn()}
      onProjectAdvancedSession={vi.fn()}
      onProjectNewWorktree={vi.fn()}
      onProjectNewSshSession={vi.fn()}
      onProjectOpenSshSettings={vi.fn()}
      onProjectOpenSecrets={vi.fn()}
      onNewSshSession={vi.fn()}
      onOpenSshSettings={vi.fn()}
      trashCount={opts.trashCount ?? 0}
      onTrashOpen={onTrashOpen}
      onProfilesOpen={profilesProp ?? undefined}
      onPortsOpen={portsProp ?? undefined}
    />
  );
  return { ...utils, onSessionClick, onTrashOpen };
}

describe("Sidebar collapsed mode (remote-dev-t9f3)", () => {
  beforeEach(() => {
    cleanup();
    mockAgentStatuses.clear();
  });

  it("renders an icon button per active session and fires onSessionClick", () => {
    const onSessionClick = vi.fn();
    const sessions = [
      makeSession({ id: "s-a", name: "Shell A" }),
      makeSession({ id: "s-b", name: "Shell B" }),
      // closed sessions are filtered upstream and should not appear
      makeSession({ id: "s-c", name: "Shell C", status: "closed" }),
    ];
    renderCollapsedSidebar({
      sessions,
      activeSessionId: "s-a",
      onSessionClick,
    });

    const a = screen.getByRole("button", { name: "Shell A" });
    const b = screen.getByRole("button", { name: "Shell B" });
    expect(a).toBeInTheDocument();
    expect(b).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shell C" })).toBeNull();

    fireEvent.click(b);
    expect(onSessionClick).toHaveBeenCalledTimes(1);
    expect(onSessionClick).toHaveBeenCalledWith("s-b");
  });

  it("marks the active session button with active styling and aria-current", () => {
    renderCollapsedSidebar({
      sessions: [
        makeSession({ id: "s-a", name: "Shell A" }),
        makeSession({ id: "s-b", name: "Shell B" }),
      ],
      activeSessionId: "s-a",
    });

    const active = screen.getByRole("button", { name: "Shell A" });
    const inactive = screen.getByRole("button", { name: "Shell B" });

    expect(active).toHaveAttribute("aria-current", "true");
    expect(inactive).not.toHaveAttribute("aria-current");
    // Active button gets the bg-accent treatment; the inner icon picks up
    // text-primary via getSessionIconColor for non-agent active sessions.
    expect(active.className).toMatch(/bg-accent/);
    const activeIcon = active.querySelector("svg");
    const inactiveIcon = inactive.querySelector("svg");
    expect(activeIcon?.getAttribute("class") ?? "").toMatch(/text-primary/);
    expect(inactiveIcon?.getAttribute("class") ?? "").not.toMatch(/text-primary/);
  });

  it("uses the plugin icon for an agent session even when worktreeBranch is set", () => {
    // Agent sessions in worktrees should still surface the agent type — the
    // pre-fix code returned GitBranch for any session with worktreeBranch and
    // hid the type signal.
    renderCollapsedSidebar({
      sessions: [
        makeSession({
          id: "agent-wt",
          name: "Agent on branch",
          terminalType: "agent" as TerminalSession["terminalType"],
          worktreeBranch: "feature/foo",
        }),
      ],
    });
    const btn = screen.getByRole("button", { name: "Agent on branch" });
    const svg = btn.querySelector("svg");
    const iconClass = svg?.getAttribute("class") ?? "";
    // The agent plugin's icon is Sparkles; lucide stamps the lowercase tag
    // name on the svg's class. GitBranch would produce "lucide-git-branch".
    expect(iconClass).not.toMatch(/lucide-git-branch/);
    expect(iconClass).toMatch(/lucide-sparkles/);
  });

  it("applies running-agent activity styling to the icon", () => {
    setMockAgentStatus("agent-running", "running");
    renderCollapsedSidebar({
      sessions: [
        makeSession({
          id: "agent-running",
          name: "Working agent",
          terminalType: "agent" as TerminalSession["terminalType"],
        }),
      ],
    });
    const btn = screen.getByRole("button", { name: "Working agent" });
    const svg = btn.querySelector("svg");
    const iconClass = svg?.getAttribute("class") ?? "";
    // getSessionIconColor returns "text-green-500 agent-breathing" for running.
    expect(iconClass).toMatch(/text-green-500/);
    expect(iconClass).toMatch(/agent-breathing/);
  });

  it("renders the rail without crashing when activity status is non-null", () => {
    // Smoke test: every status the helper handles should render cleanly.
    for (const status of ["waiting", "error", "compacting", "idle", "ended"]) {
      mockAgentStatuses.clear();
      setMockAgentStatus("smoke", status);
      const { unmount } = renderCollapsedSidebar({
        sessions: [
          makeSession({
            id: "smoke",
            name: `agent-${status}`,
            terminalType: "agent" as TerminalSession["terminalType"],
          }),
        ],
      });
      expect(
        screen.getByRole("button", { name: `agent-${status}` })
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("exposes an accessible name on the collapsed expand button", () => {
    // Tooltip text is not an accessible name; only aria-label / visible text
    // counts for screen readers. Codex review flagged that the expand toggle
    // had only a tooltip.
    renderCollapsedSidebar({ sessions: [makeSession()] });
    const expandBtn = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expandBtn).toHaveAttribute("aria-label", "Expand sidebar");
  });

  it("collapsed header dropdown contains the same create items as expanded", async () => {
    renderCollapsedSidebar({ sessions: [makeSession()] });

    const trigger = screen.getByRole("button", { name: "Create" });
    // Radix DropdownMenu opens on pointerdown/up, not React onClick — drive
    // it through user-event so the menu actually mounts.
    const user = userEvent.setup();
    await user.click(trigger);

    // Radix renders menu items inside a portal; query by role.
    expect(await screen.findByRole("menuitem", { name: /New Group/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /New Project/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /New Terminal/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /New Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /New Worktree/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Advanced/i })).toBeInTheDocument();
  });

  it("renders Profiles and Ports footer icons when their handlers are provided", () => {
    renderCollapsedSidebar({
      sessions: [makeSession()],
      onProfilesOpen: vi.fn(),
      onPortsOpen: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ports" })).toBeInTheDocument();
  });

  it("hides Profiles/Ports/Trash icons when their conditions are not met", () => {
    // Render a fully-bare Sidebar with no profile/ports handlers and zero
    // trash count, so the collapsed footer should not render at all.
    render(
      <Sidebar
        sessions={[makeSession()]}
        activeSessionId={null}
        activeProjectId={null}
        collapsed={true}
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
        onProjectSettings={vi.fn()}
        onProjectNewSession={vi.fn()}
        onProjectNewAgent={vi.fn()}
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
        // intentionally omit onProfilesOpen / onPortsOpen
      />
    );
    expect(screen.queryByRole("button", { name: "Profiles" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ports" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
  });

  it("renders the Trash icon when trashCount > 0 and fires onTrashOpen", () => {
    const onTrashOpen = vi.fn();
    renderCollapsedSidebar({
      sessions: [makeSession()],
      trashCount: 3,
      onTrashOpen,
    });
    const trash = screen.getByRole("button", { name: "Trash" });
    expect(trash).toBeInTheDocument();
    fireEvent.click(trash);
    expect(onTrashOpen).toHaveBeenCalledTimes(1);
  });
});
