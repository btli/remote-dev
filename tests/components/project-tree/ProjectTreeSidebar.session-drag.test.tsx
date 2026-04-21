import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

// Mutable session fixture swapped per-test via vi.mock factory closure.
const sessionsHolder: { list: Array<Record<string, unknown>> } = { list: [] };

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: sessionsHolder.list,
    activeSessionId: null,
    getAgentActivityStatus: () => "idle",
  }),
}));

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    getFolderPreferences: () => null,
    getNodePreferences: () => null,
    hasNodePreferences: () => false,
  }),
}));

vi.mock("@/contexts/SecretsContext", () => ({
  useSecretsContext: () => ({
    folderConfigs: new Map(),
    nodeHasActiveSecrets: () => false,
  }),
}));

vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: () => ({ notifications: [] }),
}));

const group: GroupNode = {
  id: "g1",
  name: "Workspace",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};
const p1: ProjectNode = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};
const p2: ProjectNode = {
  id: "p2",
  name: "api",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 1,
  collapsed: false,
};

const treeOverride = {
  groups: [group],
  projects: [p1, p2],
  getGroup: (id: string) => (id === "g1" ? group : undefined),
  getProject: (id: string) =>
    id === "p1" ? p1 : id === "p2" ? p2 : undefined,
  getChildrenOfGroup: (gid: string | null) =>
    gid === null
      ? { groups: [group], projects: [] }
      : gid === "g1"
      ? { groups: [], projects: [p1, p2] }
      : { groups: [], projects: [] },
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    getProjectRepoStats: () => null,
    onSessionClick: vi.fn(),
    onSessionClose: vi.fn(),
    onSessionStartEdit: vi.fn(),
    onSessionRename: vi.fn(),
    onProjectNewSession: vi.fn(),
    onProjectNewAgent: vi.fn(),
    onProjectResumeClaudeSession: vi.fn(),
    onProjectAdvancedSession: vi.fn(),
    onProjectNewWorktree: vi.fn(),
    onProjectOpenSecrets: vi.fn(),
    onProjectOpenRepository: vi.fn(),
    onProjectOpenFolderInOS: vi.fn(),
    onSessionTogglePin: vi.fn(),
    onSessionMove: vi.fn(),
    onSessionReorder: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- props type is internal; test fixture builder
  } as any;
}

// Stub getBoundingClientRect so the hook's band math is deterministic.
function stubRects(top = 0, height = 40) {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      top,
      left: 0,
      right: 100,
      bottom: top + height,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = orig;
  };
}

// happy-dom's DragEvent.dataTransfer is usable but setData/getData are no-ops.
// That's fine — our drop handlers don't actually read dataTransfer; the hook
// stores drag state internally.

function getSessionRow(container: HTMLElement, name: string) {
  return within(container).getByRole("button", { name });
}

// Minimal DataTransfer stub — happy-dom/React-synthetic events don't populate
// dataTransfer on fireEvent.drag*. The component calls setData/getData and
// reads effectAllowed/dropEffect, so we just need a compatible shape.
function makeDT() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => {
      store.set(k, v);
    },
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "move",
    dropEffect: "move",
    types: [],
    files: [],
    items: [],
    clearData: () => store.clear(),
  };
}

describe("ProjectTreeSidebar session drag", () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubRects(0, 40);
  });

  afterEach(() => {
    restore();
  });

  it("reorders within a project when session dropped on sibling (after band)", () => {
    sessionsHolder.list = [
      {
        id: "s1",
        name: "s1",
        projectId: "p1",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
      {
        id: "s2",
        name: "s2",
        projectId: "p1",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
      {
        id: "s3",
        name: "s3",
        projectId: "p2",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
    ];
    const onSessionReorder = vi.fn();
    const onSessionMove = vi.fn();
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps({ onSessionReorder, onSessionMove })} />,
      { tree: treeOverride },
    );

    const s1Row = getSessionRow(container, "s1");
    const s2Row = getSessionRow(container, "s2");
    fireEvent.dragStart(s1Row, { dataTransfer: makeDT() });
    // Drop into the "after" band of s2 — bottom 25% means clientY > 30 on a 40-tall rect.
    fireEvent.dragOver(s2Row, { clientY: 35, dataTransfer: makeDT() });
    fireEvent.drop(s2Row, { clientY: 35, dataTransfer: makeDT() });

    expect(onSessionMove).not.toHaveBeenCalled();
    expect(onSessionReorder).toHaveBeenCalledTimes(1);
    const fullOrder = onSessionReorder.mock.calls[0][0] as string[];
    // Permutation of all three sessions
    expect(new Set(fullOrder)).toEqual(new Set(["s1", "s2", "s3"]));
    // s1 now comes immediately after s2
    const s2Idx = fullOrder.indexOf("s2");
    expect(fullOrder[s2Idx + 1]).toBe("s1");
  });

  it("moves cross-project when session dropped on another project's row", () => {
    sessionsHolder.list = [
      {
        id: "s1",
        name: "s1",
        projectId: "p1",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
      {
        id: "s2",
        name: "s2",
        projectId: "p1",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
      {
        id: "s3",
        name: "s3",
        projectId: "p2",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
    ];
    const onSessionReorder = vi.fn();
    const onSessionMove = vi.fn();
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps({ onSessionReorder, onSessionMove })} />,
      { tree: treeOverride },
    );

    const s1Row = getSessionRow(container, "s1");
    // The project row renders its name as text; find the target "api" row.
    const p2Row = within(container).getByText("api").closest('[role="button"]')
      ?.parentElement as HTMLElement;
    expect(p2Row).toBeTruthy();

    fireEvent.dragStart(s1Row, { dataTransfer: makeDT() });
    // Fire dragOver + drop on the parent <div> which is our drop target
    // wrapper (sits just inside <ProjectContextMenu>).
    // The role=button element above IS the ProjectRow's inner clickable; the
    // drop wrapper is the parent div we added in this task.
    fireEvent.dragOver(p2Row, { clientY: 20, dataTransfer: makeDT() });
    fireEvent.drop(p2Row, { clientY: 20, dataTransfer: makeDT() });

    expect(onSessionReorder).not.toHaveBeenCalled();
    expect(onSessionMove).toHaveBeenCalledTimes(1);
    // Post remote-dev-oqol.4.1: session move target is the project's id,
    // not its legacy folder id.
    expect(onSessionMove).toHaveBeenCalledWith("s1", "p2");
  });

  it("does not reorder or move when dragging across pin partitions", () => {
    sessionsHolder.list = [
      {
        id: "s1",
        name: "s1",
        projectId: "p1",
        pinned: true,
        status: "running",
        terminalType: "shell",
      },
      {
        id: "s2",
        name: "s2",
        projectId: "p1",
        pinned: false,
        status: "running",
        terminalType: "shell",
      },
    ];
    const onSessionReorder = vi.fn();
    const onSessionMove = vi.fn();
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps({ onSessionReorder, onSessionMove })} />,
      { tree: treeOverride },
    );

    const s1Row = getSessionRow(container, "s1");
    const s2Row = getSessionRow(container, "s2");
    fireEvent.dragStart(s1Row, { dataTransfer: makeDT() });
    fireEvent.dragOver(s2Row, { clientY: 20, dataTransfer: makeDT() });
    fireEvent.drop(s2Row, { clientY: 20, dataTransfer: makeDT() });

    expect(onSessionReorder).not.toHaveBeenCalled();
    expect(onSessionMove).not.toHaveBeenCalled();
  });
});
