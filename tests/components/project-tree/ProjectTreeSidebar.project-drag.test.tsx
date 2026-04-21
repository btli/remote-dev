import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEvent, fireEvent, within } from "@testing-library/react";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [],
    activeSessionId: null,
    getAgentActivityStatus: () => "idle",
  }),
}));

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({ getFolderPreferences: () => null }),
}));

vi.mock("@/contexts/SecretsContext", () => ({
  useSecretsContext: () => ({ folderConfigs: new Map() }),
}));

vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: () => ({ notifications: [] }),
}));

const g1: GroupNode = {
  id: "g1",
  name: "Alpha",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};
const g2: GroupNode = {
  id: "g2",
  name: "Beta",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 1,
};

const pA: ProjectNode = {
  id: "pA",
  name: "projA",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: true,
  legacyFolderId: "f-pA",
};
const pB: ProjectNode = {
  id: "pB",
  name: "projB",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 1,
  collapsed: true,
  legacyFolderId: "f-pB",
};
const pC: ProjectNode = {
  id: "pC",
  name: "projC",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 2,
  collapsed: true,
  legacyFolderId: "f-pC",
};
const pD: ProjectNode = {
  id: "pD",
  name: "projD",
  groupId: "g2",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: true,
  legacyFolderId: "f-pD",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial ctx override intentionally loose for test fixture
function makeTreeOverride(updateProject: any, moveProject: any) {
  return {
    groups: [g1, g2],
    projects: [pA, pB, pC, pD],
    getGroup: (id: string) =>
      id === "g1" ? g1 : id === "g2" ? g2 : undefined,
    getProject: (id: string) =>
      id === "pA" ? pA : id === "pB" ? pB : id === "pC" ? pC : id === "pD" ? pD : undefined,
    getChildrenOfGroup: (gid: string | null) =>
      gid === null
        ? { groups: [g1, g2], projects: [] }
        : gid === "g1"
        ? { groups: [], projects: [pA, pB, pC] }
        : gid === "g2"
        ? { groups: [], projects: [pD] }
        : { groups: [], projects: [] },
    updateProject,
    moveProject,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- relax type for partial ctx override
  } as any;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    getProjectRepoStats: () => null,
    onSessionClick: vi.fn(),
    onSessionClose: vi.fn(),
    onSessionStartEdit: vi.fn(),
    onSessionRename: vi.fn(),
    folderHasPreferences: vi.fn(() => false),
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

// happy-dom aliases DragEvent → Event, and Event's constructor ignores
// non-standard init fields like clientY. Fire events with clientY patched on
// explicitly so the drop-band math works.
function fireDragEvent(
  kind: "dragStart" | "dragOver" | "drop" | "dragEnd" | "dragLeave",
  node: Element,
  init: { clientY?: number; dataTransfer?: unknown } = {},
) {
  const event = createEvent[kind](node, {
    dataTransfer: init.dataTransfer as never,
  });
  if (init.clientY != null) {
    Object.defineProperty(event, "clientY", {
      value: init.clientY,
      configurable: true,
    });
  }
  fireEvent(node, event);
}

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

// Find the wrapper <div> around a project row — that's the drop-target. The
// inner element with role="button" is the ProjectRow clickable surface.
function getProjectWrapper(container: HTMLElement, name: string): HTMLElement {
  const btn = within(container).getByRole("button", { name });
  // ProjectRow internal structure: wrapper div > div.group[data-active] > div[role=button]
  // The outer wrapper we added with drop handlers is the grandparent.
  const wrapper = btn.parentElement?.parentElement?.parentElement as HTMLElement;
  if (!wrapper) throw new Error(`wrapper for ${name} not found`);
  return wrapper;
}

// Find the wrapper <div> around a group row (the one we added drop handlers
// to). Same structure — wrapper > div.group > div[role=button] — so we walk up
// two levels from the role=button and then one more to get the handler
// wrapper.
function getGroupWrapper(container: HTMLElement, name: string): HTMLElement {
  const btn = within(container).getByRole("button", { name });
  const wrapper = btn.parentElement?.parentElement?.parentElement as HTMLElement;
  if (!wrapper) throw new Error(`group wrapper for ${name} not found`);
  return wrapper;
}

describe("ProjectTreeSidebar project drag", () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubRects(0, 40);
  });

  afterEach(() => {
    restore();
  });

  it("reorders within group when project dropped before another sibling", () => {
    const updateProject = vi.fn(async () => {});
    const moveProject = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateProject, moveProject) },
    );

    const pAWrapper = getProjectWrapper(container, "projA");
    const pCWrapper = getProjectWrapper(container, "projC");

    // Drop pA onto pC's top 25% → "before" band (clientY=5 on 40-tall rect).
    fireDragEvent("dragStart", pAWrapper, { dataTransfer: makeDT() });
    fireDragEvent("dragOver", pCWrapper, { clientY: 5, dataTransfer: makeDT() });
    fireDragEvent("drop", pCWrapper, { clientY: 5, dataTransfer: makeDT() });

    expect(moveProject).not.toHaveBeenCalled();
    // Target order: [pB, pA, pC] → pA sortOrder becomes 1.
    expect(updateProject).toHaveBeenCalled();
    const calls = updateProject.mock.calls.map(
      (c: unknown[]) => c[0] as { id: string; sortOrder: number },
    );
    // Assert pA ends at index 1.
    const pACall = calls.find((c) => c.id === "pA");
    expect(pACall).toEqual({ id: "pA", sortOrder: 1 });
    // pB should end at index 0 (from 1 → 0).
    const pBCall = calls.find((c) => c.id === "pB");
    expect(pBCall).toEqual({ id: "pB", sortOrder: 0 });
  });

  it("reorders within group when project dropped after another sibling", () => {
    const updateProject = vi.fn(async () => {});
    const moveProject = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateProject, moveProject) },
    );

    const pAWrapper = getProjectWrapper(container, "projA");
    const pBWrapper = getProjectWrapper(container, "projB");

    // Drop pA onto pB's bottom 25% → "after" band (clientY=35 on 40-tall rect).
    fireDragEvent("dragStart", pAWrapper, { dataTransfer: makeDT() });
    fireDragEvent("dragOver", pBWrapper, { clientY: 35, dataTransfer: makeDT() });
    fireDragEvent("drop", pBWrapper, { clientY: 35, dataTransfer: makeDT() });

    expect(moveProject).not.toHaveBeenCalled();
    // Target order: [pB, pA, pC]
    const calls = updateProject.mock.calls.map(
      (c: unknown[]) => c[0] as { id: string; sortOrder: number },
    );
    const pACall = calls.find((c) => c.id === "pA");
    expect(pACall).toEqual({ id: "pA", sortOrder: 1 });
    const pBCall = calls.find((c) => c.id === "pB");
    expect(pBCall).toEqual({ id: "pB", sortOrder: 0 });
  });

  it("moves cross-group when project dropped on a different group row", () => {
    const updateProject = vi.fn(async () => {});
    const moveProject = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateProject, moveProject) },
    );

    const pAWrapper = getProjectWrapper(container, "projA");
    const g2Wrapper = getGroupWrapper(container, "Beta");

    fireDragEvent("dragStart", pAWrapper, { dataTransfer: makeDT() });
    fireDragEvent("dragOver", g2Wrapper, { clientY: 20, dataTransfer: makeDT() });
    fireDragEvent("drop", g2Wrapper, { clientY: 20, dataTransfer: makeDT() });

    expect(updateProject).not.toHaveBeenCalled();
    expect(moveProject).toHaveBeenCalledTimes(1);
    expect(moveProject).toHaveBeenCalledWith({
      id: "pA",
      newGroupId: "g2",
    });
  });

  it("does not reorder or move when project dropped on a project in another group", () => {
    const updateProject = vi.fn(async () => {});
    const moveProject = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateProject, moveProject) },
    );

    const pAWrapper = getProjectWrapper(container, "projA");
    const pDWrapper = getProjectWrapper(container, "projD");

    fireDragEvent("dragStart", pAWrapper, { dataTransfer: makeDT() });
    fireDragEvent("dragOver", pDWrapper, { clientY: 5, dataTransfer: makeDT() });
    fireDragEvent("drop", pDWrapper, { clientY: 5, dataTransfer: makeDT() });

    expect(updateProject).not.toHaveBeenCalled();
    expect(moveProject).not.toHaveBeenCalled();
  });
});
