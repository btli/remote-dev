import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionContextMenuContent } from "@/components/session/project-tree/SessionContextMenu";
import type { TerminalSession } from "@/types/session";

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    name: "sess",
    status: "active",
    tmuxSessionName: "rdv-s1",
    projectId: "p1",
    pinned: false,
    terminalType: "shell",
    userId: "u1",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    profileId: null,
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    parentSessionId: null,
    tabOrder: 0,
    lastActivityAt: new Date("2024-01-01"),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  } as TerminalSession;
}

function setup(
  override: Partial<React.ComponentProps<typeof SessionContextMenuContent>> = {},
) {
  const handlers = {
    onStartEdit: vi.fn(),
    onTogglePin: vi.fn(),
    onMove: vi.fn(),
    onClose: vi.fn(),
  };
  const props = {
    session: makeSession(),
    projects: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ],
    ...handlers,
  };
  const utils = render(<SessionContextMenuContent {...props} {...override} />);
  return { ...utils, handlers };
}

describe("SessionContextMenuContent", () => {
  it("shows Rename, Pin Session, Move to Project, Close Session in base state", () => {
    setup();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Pin Session")).toBeInTheDocument();
    expect(screen.getByText("Move to Project")).toBeInTheDocument();
    expect(screen.getByText("Close Session")).toBeInTheDocument();
    // Schedule should not appear by default
    expect(screen.queryByText("Schedule Command")).not.toBeInTheDocument();
  });

  it("shows 'Unpin Session' label when session is pinned", () => {
    setup({ session: makeSession({ pinned: true }) });
    expect(screen.getByText("Unpin Session")).toBeInTheDocument();
    expect(screen.queryByText("Pin Session")).not.toBeInTheDocument();
  });

  it("shows 'Pin Session' label when session is not pinned", () => {
    setup({ session: makeSession({ pinned: false }) });
    expect(screen.getByText("Pin Session")).toBeInTheDocument();
    expect(screen.queryByText("Unpin Session")).not.toBeInTheDocument();
  });

  it("renders a Move to Project submenu when projects are non-empty", () => {
    setup();
    expect(screen.getByTestId("move-to-project-submenu")).toBeInTheDocument();
  });

  it("hides the Move to Project submenu when projects is empty", () => {
    setup({ projects: [] });
    expect(screen.queryByTestId("move-to-project-submenu")).not.toBeInTheDocument();
  });

  it("shows Remove from Project only when session.projectId is set", () => {
    setup({ session: makeSession({ projectId: "p1" }) });
    expect(screen.getByText("Remove from Project")).toBeInTheDocument();
  });

  it("hides Remove from Project when session.projectId is null", () => {
    setup({ session: makeSession({ projectId: null }) });
    expect(screen.queryByText("Remove from Project")).not.toBeInTheDocument();
  });

  it("lists each project by name in the move submenu", () => {
    setup();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("marks the current project as disabled in the submenu", () => {
    setup({ session: makeSession({ projectId: "p1" }) });
    // Alpha has id "p1" which matches session.projectId — should be disabled
    const alphaButton = screen.getByText("Alpha").closest("button");
    expect(alphaButton).toBeDisabled();
    // Beta has id "p2" — should not be disabled
    const betaButton = screen.getByText("Beta").closest("button");
    expect(betaButton).not.toBeDisabled();
  });

  it("shows Schedule Command only when onSchedule is provided", () => {
    const { rerender } = setup();
    expect(screen.queryByText("Schedule Command")).not.toBeInTheDocument();

    rerender(
      <SessionContextMenuContent
        session={makeSession()}
        projects={[]}
        onStartEdit={vi.fn()}
        onTogglePin={vi.fn()}
        onMove={vi.fn()}
        onClose={vi.fn()}
        onSchedule={vi.fn()}
      />,
    );
    expect(screen.getByText("Schedule Command")).toBeInTheDocument();
  });

  it("fires onStartEdit when Rename clicked", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Rename"));
    expect(handlers.onStartEdit).toHaveBeenCalledOnce();
  });

  it("fires onTogglePin when Pin Session clicked", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Pin Session"));
    expect(handlers.onTogglePin).toHaveBeenCalledOnce();
  });

  it("fires onTogglePin when Unpin Session clicked", () => {
    const { handlers } = setup({ session: makeSession({ pinned: true }) });
    fireEvent.click(screen.getByText("Unpin Session"));
    expect(handlers.onTogglePin).toHaveBeenCalledOnce();
  });

  it("fires onMove(null) when Remove from Project clicked", () => {
    const { handlers } = setup({ session: makeSession({ projectId: "p1" }) });
    fireEvent.click(screen.getByText("Remove from Project"));
    expect(handlers.onMove).toHaveBeenCalledWith(null);
  });

  it("fires onMove(projectId) when a non-current project is selected", () => {
    const { handlers } = setup({ session: makeSession({ projectId: "p1" }) });
    fireEvent.click(screen.getByText("Beta"));
    expect(handlers.onMove).toHaveBeenCalledWith("p2");
  });

  it("fires onSchedule when Schedule Command clicked", () => {
    const onSchedule = vi.fn();
    render(
      <SessionContextMenuContent
        session={makeSession()}
        projects={[]}
        onStartEdit={vi.fn()}
        onTogglePin={vi.fn()}
        onMove={vi.fn()}
        onClose={vi.fn()}
        onSchedule={onSchedule}
      />,
    );
    fireEvent.click(screen.getByText("Schedule Command"));
    expect(onSchedule).toHaveBeenCalledOnce();
  });

  it("fires onClose when Close Session clicked", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Close Session"));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("does not fire onMove when current project is clicked (disabled)", () => {
    const { handlers } = setup({ session: makeSession({ projectId: "p1" }) });
    // Alpha is the current project (p1) and should be disabled
    const alphaButton = screen.getByText("Alpha").closest("button")!;
    fireEvent.click(alphaButton);
    expect(handlers.onMove).not.toHaveBeenCalled();
  });
});
