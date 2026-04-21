import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectRow } from "@/components/session/project-tree/ProjectRow";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";

const baseProject: ProjectNode = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

const baseProps = {
  depth: 1,
  isActive: false,
  collapsed: false,
  sessionCount: 0,
  ownStats: null,
  hasCustomPrefs: false,
  hasActiveSecrets: false,
  hasLinkedRepo: false,
  onSelect: vi.fn(),
  onToggleCollapse: vi.fn(),
};

describe("ProjectRow drag passthrough", () => {
  it("invokes onDragStart when draggable and drag starts", () => {
    const onDragStart = vi.fn();
    render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        draggable
        onDragStart={onDragStart}
      />,
    );
    const row = screen.getByRole("button", { name: baseProject.name });
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row);
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("invokes onDragOver, onDragLeave, onDrop when supplied", () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        draggable
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />,
    );
    const row = screen.getByRole("button", { name: baseProject.name });
    fireEvent.dragOver(row);
    fireEvent.dragLeave(row);
    fireEvent.drop(row);
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDragLeave).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it("renders non-draggable (draggable attr false) when drag props omitted", () => {
    render(<ProjectRow {...baseProps} project={baseProject} />);
    const row = screen.getByRole("button", { name: baseProject.name });
    expect(row.getAttribute("draggable")).toBe("false");
  });
});
