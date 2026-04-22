import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroupRow } from "@/components/session/project-tree/GroupRow";
import type { GroupNode } from "@/contexts/ProjectTreeContext";

const baseGroup: GroupNode = {
  id: "g1",
  name: "Workspace",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};

const baseProps = {
  depth: 0,
  isActive: false,
  sessionCount: 0,
  rolledStats: null,
  hasCustomPrefs: false,
  onSelect: vi.fn(),
  onToggleCollapse: vi.fn(),
};

describe("GroupRow drag passthrough", () => {
  it("invokes onDragStart when draggable and drag starts", () => {
    const onDragStart = vi.fn();
    render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        draggable
        onDragStart={onDragStart}
      />,
    );
    const row = screen.getByRole("button", { name: baseGroup.name });
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row);
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("invokes onDragOver, onDragLeave, onDrop when supplied", () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        draggable
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />,
    );
    const row = screen.getByRole("button", { name: baseGroup.name });
    fireEvent.dragOver(row);
    fireEvent.dragLeave(row);
    fireEvent.drop(row);
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDragLeave).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it("renders non-draggable (draggable attr false) when drag props omitted", () => {
    render(<GroupRow {...baseProps} group={baseGroup} />);
    const row = screen.getByRole("button", { name: baseGroup.name });
    expect(row.getAttribute("draggable")).toBe("false");
  });
});
