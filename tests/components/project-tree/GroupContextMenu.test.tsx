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
    onMoveToRoot: vi.fn(),
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
    onMoveToRoot: vi.fn(),
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
    expect(screen.getByText("Move to Root")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("hides Move to Root when the group is at root", () => {
    setupContent({ group: { ...baseGroup, parentGroupId: null } });
    expect(screen.queryByText("Move to Root")).not.toBeInTheDocument();
  });

  it("shows Move to Root when the group has a parent", () => {
    setupContent({ group: { ...baseGroup, parentGroupId: "parent-id" } });
    expect(screen.getByText("Move to Root")).toBeInTheDocument();
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

  it("fires onMoveToRoot when Move to Root is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("Move to Root"));
    expect(handlers.onMoveToRoot).toHaveBeenCalledOnce();
  });

  it("fires onDelete when Delete is clicked", () => {
    const { handlers } = setupContent();
    fireEvent.click(screen.getByText("Delete"));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
  });
});

describe("GroupContextMenu (wrapper component)", () => {
  it("renders the trigger child", () => {
    setup();
    expect(screen.getByText("trigger")).toBeInTheDocument();
  });
});
