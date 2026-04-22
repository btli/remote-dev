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

describe("GroupRow", () => {
  it("renders the group name", () => {
    render(<GroupRow {...baseProps} group={baseGroup} />);
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });

  it("renders chevron down when expanded", () => {
    const { container } = render(<GroupRow {...baseProps} group={baseGroup} />);
    expect(container.querySelector('[data-lucide="chevron-down"], svg.lucide-chevron-down')).toBeTruthy();
  });

  it("renders chevron right when collapsed", () => {
    const collapsed = { ...baseGroup, collapsed: true };
    const { container } = render(<GroupRow {...baseProps} group={collapsed} />);
    expect(container.querySelector('[data-lucide="chevron-right"], svg.lucide-chevron-right')).toBeTruthy();
  });

  it("calls onToggleCollapse when chevron clicked and does NOT fire onSelect", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <GroupRow {...baseProps} group={baseGroup} onToggleCollapse={onToggle} onSelect={onSelect} />
    );
    const chevron = container.querySelector('button[aria-label="Toggle group"]') as HTMLElement;
    expect(chevron).toBeTruthy();
    fireEvent.click(chevron);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelect when name clicked", () => {
    const onSelect = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Workspace"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("calls onOpenPreferences when gear clicked", () => {
    const onOpenPreferences = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} onOpenPreferences={onOpenPreferences} />);
    fireEvent.click(screen.getByRole("button", { name: /group preferences/i }));
    expect(onOpenPreferences).toHaveBeenCalledOnce();
  });

  it("does not render gear when onOpenPreferences is undefined", () => {
    render(<GroupRow {...baseProps} group={baseGroup} />);
    expect(screen.queryByRole("button", { name: /group preferences/i })).toBeNull();
  });

  it("hides children when group.collapsed is true", () => {
    const collapsed = { ...baseGroup, collapsed: true };
    render(
      <GroupRow {...baseProps} group={collapsed}>
        <div data-testid="child">hidden</div>
      </GroupRow>
    );
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("renders children when group.collapsed is false", () => {
    render(
      <GroupRow {...baseProps} group={baseGroup}>
        <div data-testid="child">visible</div>
      </GroupRow>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders session count badge when sessionCount > 0", () => {
    render(<GroupRow {...baseProps} group={baseGroup} sessionCount={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not render session count badge when sessionCount === 0", () => {
    render(<GroupRow {...baseProps} group={baseGroup} sessionCount={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders PR badge when rolledStats.prCount > 0", () => {
    render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        rolledStats={{ prCount: 3, issueCount: 0, hasChanges: false }}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders issue badge when rolledStats.issueCount > 0", () => {
    render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        rolledStats={{ prCount: 0, issueCount: 2, hasChanges: false }}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders changes dot when rolledStats.hasChanges is true", () => {
    const { container } = render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        rolledStats={{ prCount: 0, issueCount: 0, hasChanges: true }}
      />
    );
    expect(container.querySelector(".animate-pulse.bg-orange-400")).toBeTruthy();
  });

  it("renders nothing in the stats area when rolledStats is null", () => {
    const { container } = render(<GroupRow {...baseProps} group={baseGroup} rolledStats={null} />);
    expect(container.querySelector(".animate-pulse.bg-orange-400")).toBeNull();
  });

  it("always renders four right-anchored stat slots (pr/issue/changes/sessions)", () => {
    render(<GroupRow {...baseProps} group={baseGroup} rolledStats={null} sessionCount={0} />);
    expect(screen.getByTestId("row-stat-pr")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-issue")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-changes")).toBeInTheDocument();
    expect(screen.getByTestId("row-stat-sessions")).toBeInTheDocument();
  });

  it("populates the pr slot only when prCount > 0", () => {
    const { rerender } = render(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        rolledStats={{ prCount: 0, issueCount: 0, hasChanges: false }}
      />
    );
    expect(screen.getByTestId("row-stat-pr").textContent).toBe("");
    rerender(
      <GroupRow
        {...baseProps}
        group={baseGroup}
        rolledStats={{ prCount: 4, issueCount: 0, hasChanges: false }}
      />
    );
    expect(screen.getByTestId("row-stat-pr").textContent).toContain("4");
  });

  it("populates the session slot only when sessionCount > 0", () => {
    const { rerender } = render(<GroupRow {...baseProps} group={baseGroup} sessionCount={0} />);
    expect(screen.getByTestId("row-stat-sessions").textContent).toBe("");
    rerender(<GroupRow {...baseProps} group={baseGroup} sessionCount={7} />);
    expect(screen.getByTestId("row-stat-sessions").textContent).toContain("7");
  });

  it("applies active styling when isActive is true", () => {
    const { container } = render(<GroupRow {...baseProps} group={baseGroup} isActive />);
    // At minimum an active class marker on the row container
    expect(container.querySelector('[data-active="true"], .bg-accent\\/50, .ring-primary\\/50')).toBeTruthy();
  });

  it("fires onSelect when Enter is pressed on the focused row", () => {
    const onSelect = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: baseGroup.name });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("fires onSelect when Space is pressed", () => {
    const onSelect = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: baseGroup.name });
    fireEvent.keyDown(row, { key: " " });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // Inline rename tests
  it("renders an input in place of the name when isEditing", () => {
    render(<GroupRow {...baseProps} group={baseGroup} isEditing />);
    expect(screen.getByRole("textbox")).toHaveValue(baseGroup.name);
  });

  it("prefers editValue over group.name when provided", () => {
    render(<GroupRow {...baseProps} group={baseGroup} isEditing editValue="custom" />);
    expect(screen.getByRole("textbox")).toHaveValue("custom");
  });

  it("calls onSaveEdit(trimmed) on Enter with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSaveEdit).toHaveBeenCalledWith("Renamed");
  });

  it("calls onCancelEdit (not onSaveEdit) on Enter when value is unchanged", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("calls onCancelEdit on Escape without submitting", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} isEditing onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it("fires onStartEdit on double-click of the name", () => {
    const onStartEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} onStartEdit={onStartEdit} />);
    fireEvent.doubleClick(screen.getByText(baseGroup.name));
    expect(onStartEdit).toHaveBeenCalled();
  });

  it("does not double-submit when Enter then blur fire", () => {
    const onSaveEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
  });

  it("commits on blur with a new value", () => {
    const onSaveEdit = vi.fn();
    render(<GroupRow {...baseProps} group={baseGroup} isEditing onSaveEdit={onSaveEdit} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Blurred" } });
    fireEvent.blur(input);
    expect(onSaveEdit).toHaveBeenCalledWith("Blurred");
  });
});
