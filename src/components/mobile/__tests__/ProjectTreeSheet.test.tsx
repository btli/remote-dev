/**
 * ProjectTreeSheet tests (Phase 2 mobile redesign).
 *
 * Verifies search-based filtering, expand/collapse on group taps, and that
 * picking a project closes the sheet and writes the active node back.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ProjectTreeContext,
  type GroupNode,
  type ProjectNode,
  type ProjectTreeContextValue,
} from "@/contexts/ProjectTreeContext";
import { ProjectTreeSheet } from "@/components/mobile/sessions/ProjectTreeSheet";

afterEach(() => cleanup());

function makeTree(
  groups: GroupNode[],
  projects: ProjectNode[],
  overrides: Partial<ProjectTreeContextValue> = {}
): ProjectTreeContextValue {
  return {
    groups,
    projects,
    isLoading: false,
    activeNode: null,
    getGroup: (id) => groups.find((g) => g.id === id),
    getProject: (id) => projects.find((p) => p.id === id),
    getChildrenOfGroup: () => ({ groups: [], projects: [] }),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    moveGroup: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    moveProject: vi.fn(),
    setActiveNode: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const sampleGroups: GroupNode[] = [
  { id: "g1", name: "Open Source", parentGroupId: null, collapsed: false, sortOrder: 0 },
  { id: "g2", name: "Work", parentGroupId: null, collapsed: false, sortOrder: 1 },
];
const sampleProjects: ProjectNode[] = [
  { id: "p1", name: "remote-dev", groupId: "g1", isAutoCreated: false, sortOrder: 0, collapsed: false },
  { id: "p2", name: "linear-clone", groupId: "g2", isAutoCreated: false, sortOrder: 0, collapsed: false },
  { id: "p3", name: "personal-notes", groupId: null, isAutoCreated: false, sortOrder: 0, collapsed: false },
];

describe("ProjectTreeSheet", () => {
  it("filters tree rows by the search input", async () => {
    const user = userEvent.setup();
    const tree = makeTree(sampleGroups, sampleProjects);
    render(
      <ProjectTreeContext.Provider value={tree}>
        <ProjectTreeSheet open={true} onOpenChange={vi.fn()} />
      </ProjectTreeContext.Provider>
    );
    expect(screen.getByText("remote-dev")).toBeInTheDocument();
    expect(screen.getByText("linear-clone")).toBeInTheDocument();
    const search = screen.getByLabelText("Search projects");
    await user.type(search, "linear");
    expect(screen.queryByText("remote-dev")).not.toBeInTheDocument();
    expect(screen.getByText("linear-clone")).toBeInTheDocument();
  });

  it("calls setActiveNode and onOpenChange(false) when a project is picked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const setActive = vi.fn().mockResolvedValue(undefined);
    const tree = makeTree(sampleGroups, sampleProjects, { setActiveNode: setActive });
    render(
      <ProjectTreeContext.Provider value={tree}>
        <ProjectTreeSheet open={true} onOpenChange={onOpenChange} />
      </ProjectTreeContext.Provider>
    );
    await user.click(screen.getByText("remote-dev"));
    expect(setActive).toHaveBeenCalledWith({ id: "p1", type: "project" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toggles a group's expanded state when the chevron is tapped", () => {
    const tree = makeTree(sampleGroups, sampleProjects);
    render(
      <ProjectTreeContext.Provider value={tree}>
        <ProjectTreeSheet open={true} onOpenChange={vi.fn()} />
      </ProjectTreeContext.Provider>
    );
    // Initial: g1 is expanded (collapsed=false), so its child remote-dev is visible.
    expect(screen.getByText("remote-dev")).toBeInTheDocument();
    const collapseBtn = screen.getByLabelText("Collapse Open Source");
    fireEvent.click(collapseBtn);
    expect(screen.queryByText("remote-dev")).not.toBeInTheDocument();
  });

  it("renders a 'No matches.' state when the search has no hits", async () => {
    const user = userEvent.setup();
    const tree = makeTree(sampleGroups, sampleProjects);
    render(
      <ProjectTreeContext.Provider value={tree}>
        <ProjectTreeSheet open={true} onOpenChange={vi.fn()} />
      </ProjectTreeContext.Provider>
    );
    const search = screen.getByLabelText("Search projects");
    await user.type(search, "nonexistent-zzzzz");
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });
});
