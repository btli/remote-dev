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

describe("ProjectRow", () => {
  it("renders the project name", () => {
    render(<ProjectRow {...baseProps} project={baseProject} />);
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("renders chevron down when expanded", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} />);
    expect(container.querySelector('svg.lucide-chevron-down')).toBeTruthy();
  });

  it("renders chevron right when collapsed", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} collapsed />);
    expect(container.querySelector('svg.lucide-chevron-right')).toBeTruthy();
  });

  it("calls onToggleCollapse when chevron clicked and does NOT fire onSelect", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <ProjectRow {...baseProps} project={baseProject} onToggleCollapse={onToggle} onSelect={onSelect} />
    );
    const chevron = container.querySelector('button[aria-label="Toggle project"]') as HTMLElement;
    expect(chevron).toBeTruthy();
    fireEvent.click(chevron);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelect when name clicked", () => {
    const onSelect = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("app"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("calls onOpenPreferences when gear clicked", () => {
    const onOpenPreferences = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} onOpenPreferences={onOpenPreferences} />);
    fireEvent.click(screen.getByRole("button", { name: /project preferences/i }));
    expect(onOpenPreferences).toHaveBeenCalledOnce();
  });

  it("does not render gear when onOpenPreferences is undefined", () => {
    render(<ProjectRow {...baseProps} project={baseProject} />);
    expect(screen.queryByRole("button", { name: /project preferences/i })).toBeNull();
  });

  it("hides children when collapsed", () => {
    render(
      <ProjectRow {...baseProps} project={baseProject} collapsed>
        <div data-testid="child">hidden</div>
      </ProjectRow>
    );
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("renders children when expanded", () => {
    render(
      <ProjectRow {...baseProps} project={baseProject}>
        <div data-testid="child">visible</div>
      </ProjectRow>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders session count badge when sessionCount > 0", () => {
    render(<ProjectRow {...baseProps} project={baseProject} sessionCount={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("does not render session count badge when sessionCount === 0", () => {
    render(<ProjectRow {...baseProps} project={baseProject} sessionCount={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders PR badge when ownStats.prCount > 0", () => {
    render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        ownStats={{ prCount: 7, issueCount: 0, hasChanges: false }}
      />
    );
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders issue badge when ownStats.issueCount > 0", () => {
    render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        ownStats={{ prCount: 0, issueCount: 5, hasChanges: false }}
      />
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders changes dot when ownStats.hasChanges is true", () => {
    const { container } = render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        ownStats={{ prCount: 0, issueCount: 0, hasChanges: true }}
      />
    );
    expect(container.querySelector(".animate-pulse.bg-orange-400")).toBeTruthy();
  });

  it("renders nothing in the stats area when ownStats is null", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} ownStats={null} />);
    expect(container.querySelector(".animate-pulse.bg-orange-400")).toBeNull();
  });

  it("always renders four right-anchored stat slots (pr/issue/changes/sessions)", () => {
    render(<ProjectRow {...baseProps} project={baseProject} ownStats={null} sessionCount={0} />);
    expect(screen.getByTestId("row-stat-pr")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-issue")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-changes")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-sessions")).toBeInTheDocument();
  });

  it("populates the issue slot only when issueCount > 0", () => {
    const { rerender } = render(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        ownStats={{ prCount: 0, issueCount: 0, hasChanges: false }}
      />
    );
    expect(screen.getByTestId("row-stat-issue").textContent).toBe("");
    rerender(
      <ProjectRow
        {...baseProps}
        project={baseProject}
        ownStats={{ prCount: 0, issueCount: 9, hasChanges: false }}
      />
    );
    expect(screen.getByTestId("row-stat-issue").textContent).toContain("9");
  });

  it("populates the session slot only when sessionCount > 0", () => {
    const { rerender } = render(<ProjectRow {...baseProps} project={baseProject} sessionCount={0} />);
    expect(screen.getByTestId("row-stat-sessions").textContent).toBe("");
    rerender(<ProjectRow {...baseProps} project={baseProject} sessionCount={3} />);
    expect(screen.getByTestId("row-stat-sessions").textContent).toContain("3");
  });

  it("renders a GitBranch indicator when hasLinkedRepo", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} hasLinkedRepo />);
    expect(container.querySelector('svg.lucide-git-branch')).toBeTruthy();
  });

  it("does not render GitBranch indicator when !hasLinkedRepo", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} />);
    expect(container.querySelector('svg.lucide-git-branch')).toBeNull();
  });

  it("applies active styling when isActive is true", () => {
    const { container } = render(<ProjectRow {...baseProps} project={baseProject} isActive />);
    expect(container.querySelector('[data-active="true"]')).toBeTruthy();
  });

  it("fires onSelect when Enter is pressed on the focused row", () => {
    const onSelect = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: baseProject.name });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("fires onSelect when Space is pressed", () => {
    const onSelect = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: baseProject.name });
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Inline rename tests
  it("renders an input in place of the name when isEditing", () => {
    render(<ProjectRow {...baseProps} project={baseProject} isEditing />);
    expect(screen.getByRole("textbox")).toHaveValue(baseProject.name);
  });

  it("prefers editValue over project.name when provided", () => {
    render(<ProjectRow {...baseProps} project={baseProject} isEditing editValue="custom" />);
    expect(screen.getByRole("textbox")).toHaveValue("custom");
  });

  it("calls onSaveEdit(trimmed) on Enter with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSaveEdit).toHaveBeenCalledWith("Renamed");
  });

  it("calls onCancelEdit (not onSaveEdit) on Enter when value is unchanged", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("calls onCancelEdit on Escape without submitting", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("fires onStartEdit on double-click of the name", () => {
    const onStartEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} onStartEdit={onStartEdit} />);
    fireEvent.doubleClick(screen.getByText(baseProject.name));
    expect(onStartEdit).toHaveBeenCalled();
  });

  it("does not double-submit when Enter then blur fire", () => {
    const onSaveEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
  });

  it("commits on blur with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<ProjectRow {...baseProps} project={baseProject} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Blurred" } });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledWith("Blurred");
  });
});
