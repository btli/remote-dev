import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  GroupContextMenu,
  GroupContextMenuContent,
} from "@/components/session/project-tree/GroupContextMenu";
import type { GroupNode } from "@/contexts/ProjectTreeContext";

const baseGroup: GroupNode = {
  id: "g1",
  name: "Workspace",
  parentGroupId: "parent",
  collapsed: false,
  sortOrder: 0,
};

function setupContent(
  override: Partial<React.ComponentProps<typeof GroupContextMenuContent>> = {},
) {
  const handlers = {
    onCreateProject: vi.fn(),
    onCreateSubgroup: vi.fn(),
    onOpenPreferences: vi.fn(),
    onStartEdit: vi.fn(),
    onMoveToGroup: vi.fn(),
    onDelete: vi.fn(),
  };
  const utils = render(
    <GroupContextMenuContent
      group={baseGroup}
      hasCustomPrefs={false}
      {...handlers}
      {...override}
    />,
  );
  return { ...utils, handlers };
}

function setup(
  override: Partial<React.ComponentProps<typeof GroupContextMenu>> = {},
) {
  const handlers = {
    onCreateProject: vi.fn(),
    onCreateSubgroup: vi.fn(),
    onOpenPreferences: vi.fn(),
    onStartEdit: vi.fn(),
    onMoveToGroup: vi.fn(),
    onDelete: vi.fn(),
  };
  const utils = render(
    <GroupContextMenu
      group={baseGroup}
      hasCustomPrefs={false}
      {...handlers}
      {...override}
    >
      <button>trigger</button>
    </GroupContextMenu>,
  );
  // attempt to open the menu via contextmenu event
  fireEvent.contextMenu(screen.getByText("trigger"));
  return { ...utils, handlers };
}

describe("GroupContextMenu (content extraction tests)", () => {
  it("shows all base items when opened for a non-root group", () => {
    setupContent();
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("New Subgroup")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    // "Move to Group" submenu header is rendered when onMoveToGroup is provided
    expect(screen.getByTestId("move-to-group-submenu")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("shows the Custom badge when hasCustomPrefs is true", () => {
    setupContent({ hasCustomPrefs: true });
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("does not show the Custom badge when hasCustomPrefs is false", () => {
    setupContent();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });

  it("fires onCreateProject when New Project is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("New Project"));
    expect(handlers.onCreateProject).toHaveBeenCalledOnce();
  });

  it("fires onCreateSubgroup when New Subgroup is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("New Subgroup"));
    expect(handlers.onCreateSubgroup).toHaveBeenCalledOnce();
  });

  it("fires onOpenPreferences when Preferences is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("Preferences"));
    expect(handlers.onOpenPreferences).toHaveBeenCalledOnce();
  });

  it("fires onStartEdit when Rename is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("Rename"));
    expect(handlers.onStartEdit).toHaveBeenCalledOnce();
  });

  it("fires onDelete when Delete is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("Delete"));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
  });

  it("does not render the move submenu when onMoveToGroup is omitted", () => {
    setupContent({ onMoveToGroup: undefined });
    expect(screen.queryByTestId("move-to-group-submenu")).not.toBeInTheDocument();
  });

  it("Root (top level) is disabled when the group is already at root", () => {
    setupContent({ group: { ...baseGroup, parentGroupId: null } });
    expect(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    ).toBeDisabled();
  });

  it("Root (top level) is enabled when the group has a parent", () => {
    setupContent();
    expect(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    ).not.toBeDisabled();
  });

  it("fires onMoveToGroup(null) when Root (top level) is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Root \(top level\)/ }),
    );
    expect(handlers.onMoveToGroup).toHaveBeenCalledWith(null);
  });

  it("lists moveTargetGroups and fires onMoveToGroup(gid) on click", () => {
    const moveTargetGroups = [
      { id: "other1", name: "Other One" },
      { id: "other2", name: "Other Two" },
    ];
    const { handlers } = setupContent({ moveTargetGroups });
    expect(screen.getByText("Other One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Other One/ }));
    expect(handlers.onMoveToGroup).toHaveBeenCalledWith("other1");
  });

  it("disables the move target that matches current parentGroupId", () => {
    const moveTargetGroups = [{ id: "parent", name: "Parent Group" }];
    setupContent({ moveTargetGroups });
    expect(
      screen.getByRole("menuitem", { name: /Parent Group/ }),
    ).toBeDisabled();
  });
});

describe("GroupContextMenu collapse/expand item", () => {
  it("does not render when onToggleCollapse is omitted", () => {
    setupContent();
    expect(
      screen.queryByRole("menuitem", { name: /^Collapse$|^Expand$/ }),
    ).not.toBeInTheDocument();
  });

  it("renders 'Collapse' when group is expanded (collapsed === false)", () => {
    setupContent({ onToggleCollapse: vi.fn() });
    expect(
      screen.getByRole("menuitem", { name: /^Collapse$/ }),
    ).toBeInTheDocument();
  });

  it("renders 'Expand' when group is collapsed", () => {
    setupContent({
      group: { ...baseGroup, collapsed: true },
      onToggleCollapse: vi.fn(),
    });
    expect(
      screen.getByRole("menuitem", { name: /^Expand$/ }),
    ).toBeInTheDocument();
  });

  it("fires onToggleCollapse when clicked", () => {
    const onToggleCollapse = vi.fn();
    setupContent({ onToggleCollapse });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Collapse$/ }));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });
});

describe("GroupContextMenu (wrapper component)", () => {
  it("renders the trigger child", () => {
    setup();
    expect(screen.getByText("trigger")).toBeInTheDocument();
  });
});
