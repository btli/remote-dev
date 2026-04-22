import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectContextMenuContent } from "@/components/session/project-tree/ProjectContextMenu";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";

const baseProject: ProjectNode = {
  id: "p1",
  name: "My Project",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

function setup(
  override: Partial<React.ComponentProps<typeof ProjectContextMenuContent>> = {},
) {
  const handlers = {
    onNewTerminal: vi.fn(),
    onNewAgent: vi.fn(),
    onResume: vi.fn(),
    onAdvanced: vi.fn(),
    onNewWorktree: vi.fn(),
    onOpenPreferences: vi.fn(),
    onOpenSecrets: vi.fn(),
    onOpenRepository: vi.fn(),
    onOpenFolderInOS: vi.fn(),
    onStartEdit: vi.fn(),
    onDelete: vi.fn(),
  };
  const props = {
    project: baseProject,
    hasCustomPrefs: false,
    hasActiveSecrets: false,
    hasLinkedRepo: false,
    hasWorkingDirectory: false,
    ...handlers,
  };
  const utils = render(<ProjectContextMenuContent {...props} {...override} />);
  return { ...utils, handlers };
}

describe("ProjectContextMenuContent", () => {
  it("shows all base items for a project without repo/secrets/prefs/working-dir", () => {
    setup();
    expect(screen.getByText("New Terminal")).toBeInTheDocument();
    expect(screen.getByText("New Agent")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.getByText("Advanced…")).toBeInTheDocument();
    expect(screen.getByText("New Worktree")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Secrets")).toBeInTheDocument();
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    // conditional items hidden
    expect(screen.queryByText("Open Folder")).not.toBeInTheDocument();
    expect(screen.queryByText("View Issues")).not.toBeInTheDocument();
    expect(screen.queryByText("View PRs")).not.toBeInTheDocument();
  });

  it("disables New Worktree when hasLinkedRepo is false", () => {
    setup();
    expect(screen.getByText("New Worktree").closest("button")).toBeDisabled();
  });

  it("enables New Worktree when hasLinkedRepo is true", () => {
    setup({ hasLinkedRepo: true });
    expect(
      screen.getByText("New Worktree").closest("button"),
    ).not.toBeDisabled();
  });

  it("shows Custom badge when hasCustomPrefs", () => {
    setup({ hasCustomPrefs: true });
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("shows Active badge when hasActiveSecrets", () => {
    setup({ hasActiveSecrets: true });
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Linked badge when hasLinkedRepo", () => {
    setup({ hasLinkedRepo: true });
    expect(screen.getByText("Linked")).toBeInTheDocument();
  });

  it("shows Open Folder when hasWorkingDirectory is true", () => {
    setup({ hasWorkingDirectory: true });
    expect(screen.getByText("Open Folder")).toBeInTheDocument();
  });

  it("hides Open Folder when hasWorkingDirectory is false", () => {
    setup({ hasWorkingDirectory: false });
    expect(screen.queryByText("Open Folder")).not.toBeInTheDocument();
  });

  it("shows View Issues only when onViewIssues provided AND hasLinkedRepo", () => {
    setup({ hasLinkedRepo: true, onViewIssues: vi.fn() });
    expect(screen.getByText("View Issues")).toBeInTheDocument();
  });

  it("hides View Issues when onViewIssues provided but no linked repo", () => {
    setup({ onViewIssues: vi.fn() });
    expect(screen.queryByText("View Issues")).not.toBeInTheDocument();
  });

  it("shows View PRs only when onViewPRs provided AND hasLinkedRepo", () => {
    setup({ hasLinkedRepo: true, onViewPRs: vi.fn() });
    expect(screen.getByText("View PRs")).toBeInTheDocument();
  });

  it("fires onNewTerminal", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("New Terminal"));
    expect(handlers.onNewTerminal).toHaveBeenCalledOnce();
  });

  it("fires onNewAgent", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("New Agent"));
    expect(handlers.onNewAgent).toHaveBeenCalledOnce();
  });

  it("fires onResume", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Resume"));
    expect(handlers.onResume).toHaveBeenCalledOnce();
  });

  it("fires onAdvanced", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Advanced…"));
    expect(handlers.onAdvanced).toHaveBeenCalledOnce();
  });

  it("fires onNewWorktree when enabled", () => {
    const { handlers } = setup({ hasLinkedRepo: true });
    fireEvent.click(screen.getByText("New Worktree"));
    expect(handlers.onNewWorktree).toHaveBeenCalledOnce();
  });

  it("does not fire onNewWorktree when disabled", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("New Worktree"));
    expect(handlers.onNewWorktree).not.toHaveBeenCalled();
  });

  it("fires onOpenPreferences", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Preferences"));
    expect(handlers.onOpenPreferences).toHaveBeenCalledOnce();
  });

  it("fires onOpenSecrets", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Secrets"));
    expect(handlers.onOpenSecrets).toHaveBeenCalledOnce();
  });

  it("fires onOpenRepository", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Repository"));
    expect(handlers.onOpenRepository).toHaveBeenCalledOnce();
  });

  it("fires onOpenFolderInOS", () => {
    const { handlers } = setup({ hasWorkingDirectory: true });
    fireEvent.click(screen.getByText("Open Folder"));
    expect(handlers.onOpenFolderInOS).toHaveBeenCalledOnce();
  });

  it("fires onStartEdit from Rename", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Rename"));
    expect(handlers.onStartEdit).toHaveBeenCalledOnce();
  });

  it("fires onDelete from Delete", () => {
    const { handlers } = setup();
    fireEvent.click(screen.getByText("Delete"));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
  });

  it("does not render move-to-group submenu when onMoveToGroup is omitted", () => {
    setup();
    expect(
      screen.queryByTestId("move-to-group-submenu"),
    ).not.toBeInTheDocument();
  });

  it("renders move-to-group submenu when onMoveToGroup is provided", () => {
    setup({ onMoveToGroup: vi.fn() });
    expect(
      screen.getByTestId("move-to-group-submenu"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    ).toBeInTheDocument();
  });

  it("fires onMoveToGroup(gid) when a move target is clicked", () => {
    const onMoveToGroup = vi.fn();
    setup({
      onMoveToGroup,
      moveTargetGroups: [{ id: "gOther", name: "Other Group" }],
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Other Group/ }));
    expect(onMoveToGroup).toHaveBeenCalledWith("gOther");
  });

  it("disables move target that matches the project's current groupId", () => {
    setup({
      onMoveToGroup: vi.fn(),
      moveTargetGroups: [{ id: "g1", name: "Current Group" }],
    });
    expect(
      screen.getByRole("menuitem", { name: /Current Group/ }),
    ).toBeDisabled();
  });

  it("Root (top level) is disabled when project.groupId is already null", () => {
    setup({
      project: { ...baseProject, groupId: null },
      onMoveToGroup: vi.fn(),
    });
    expect(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    ).toBeDisabled();
  });

  it("fires onMoveToGroup(null) when Root (top level) is clicked", () => {
    const onMoveToGroup = vi.fn();
    setup({ onMoveToGroup });
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    );
    expect(onMoveToGroup).toHaveBeenCalledWith(null);
  });

  it("does not render Collapse/Expand when onToggleCollapse is omitted", () => {
    setup();
    expect(
      screen.queryByRole("menuitem", { name: /^Collapse$|^Expand$/ }),
    ).not.toBeInTheDocument();
  });

  it("renders 'Collapse' when project is expanded", () => {
    setup({ onToggleCollapse: vi.fn() });
    expect(
      screen.getByRole("menuitem", { name: /^Collapse$/ }),
    ).toBeInTheDocument();
  });

  it("renders 'Expand' when project is collapsed", () => {
    setup({
      project: { ...baseProject, collapsed: true },
      onToggleCollapse: vi.fn(),
    });
    expect(
      screen.getByRole("menuitem", { name: /^Expand$/ }),
    ).toBeInTheDocument();
  });

  it("fires onToggleCollapse when clicked", () => {
    const onToggleCollapse = vi.fn();
    setup({ onToggleCollapse });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Collapse$/ }));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });
});
