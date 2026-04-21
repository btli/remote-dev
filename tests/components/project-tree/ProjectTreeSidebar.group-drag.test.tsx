import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { within } from "@testing-library/react";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { fireDragEvent } from "../../helpers/dragEvent";
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

const gA: GroupNode = {
  id: "gA",
  name: "Alpha",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};
const gB: GroupNode = {
  id: "gB",
  name: "Beta",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 1,
};
const gC: GroupNode = {
  id: "gC",
  name: "Gamma",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 2,
};
const gA1: GroupNode = {
  id: "gA1",
  name: "AlphaChild",
  parentGroupId: "gA",
  collapsed: false,
  sortOrder: 0,
};
const gB1: GroupNode = {
  id: "gB1",
  name: "BetaChild1",
  parentGroupId: "gB",
  collapsed: false,
  sortOrder: 0,
};
const gB2: GroupNode = {
  id: "gB2",
  name: "BetaChild2",
  parentGroupId: "gB",
  collapsed: false,
  sortOrder: 1,
};

const ALL_GROUPS: GroupNode[] = [gA, gB, gC, gA1, gB1, gB2];
const ALL_PROJECTS: ProjectNode[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial ctx override intentionally loose for test fixture
function makeTreeOverride(updateGroup: any, moveGroup: any) {
  return {
    groups: ALL_GROUPS,
    projects: ALL_PROJECTS,
    getGroup: (id: string) => ALL_GROUPS.find((g) => g.id === id),
    getProject: () => undefined,
    getChildrenOfGroup: (gid: string | null) => {
      const groups = ALL_GROUPS.filter((g) => g.parentGroupId === gid).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      return { groups, projects: [] };
    },
    updateGroup,
    moveGroup,
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

// Find the wrapper <div draggable> around a group row (the one we added drop
// handlers to). DOM structure:
//   wrapper <div draggable>
//     > GroupRow root <div className="space-y-0.5">
//       > <div className="group">
//         > <div role="button">
// 3 parentElement hops from the role=button gets us to the wrapper.
function getGroupWrapper(container: HTMLElement, name: string): HTMLElement {
  const btn = within(container).getByRole("button", { name });
  const wrapper = btn.parentElement?.parentElement?.parentElement as HTMLElement;
  if (!wrapper) throw new Error(`group wrapper for ${name} not found`);
  return wrapper;
}

describe("ProjectTreeSidebar group drag", () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubRects(0, 40);
  });

  afterEach(() => {
    restore();
  });

  it("reorders siblings when dropped on another group's top band (before)", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gCWrapper = getGroupWrapper(container, "Gamma");
    const gAWrapper = getGroupWrapper(container, "Alpha");

    // Drag gC onto gA top 25% → before. New order: gC, gA, gB.
    fireDragEvent(gCWrapper, "dragStart", { dataTransfer: makeDT() });
    fireDragEvent(gAWrapper, "dragOver", {
      clientY: 5,
      dataTransfer: makeDT(),
    });
    fireDragEvent(gAWrapper, "drop", { clientY: 5, dataTransfer: makeDT() });

    expect(moveGroup).not.toHaveBeenCalled();
    expect(updateGroup).toHaveBeenCalled();

    const calls = updateGroup.mock.calls.map(
      (c: unknown[]) => c[0] as { id: string; sortOrder: number },
    );
    // Expected end state: gC=0, gA=1, gB=2 (gB was already at 1 → becomes 2)
    const gCCall = calls.find((c) => c.id === "gC");
    const gACall = calls.find((c) => c.id === "gA");
    const gBCall = calls.find((c) => c.id === "gB");
    expect(gCCall).toEqual({ id: "gC", sortOrder: 0 });
    expect(gACall).toEqual({ id: "gA", sortOrder: 1 });
    expect(gBCall).toEqual({ id: "gB", sortOrder: 2 });
  });

  it("reorders siblings when dropped on another group's bottom band (after)", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gAWrapper = getGroupWrapper(container, "Alpha");
    const gCWrapper = getGroupWrapper(container, "Gamma");

    // Drag gA onto gC bottom 25% → after. New order: gB, gC, gA.
    fireDragEvent(gAWrapper, "dragStart", { dataTransfer: makeDT() });
    fireDragEvent(gCWrapper, "dragOver", {
      clientY: 35,
      dataTransfer: makeDT(),
    });
    fireDragEvent(gCWrapper, "drop", { clientY: 35, dataTransfer: makeDT() });

    expect(moveGroup).not.toHaveBeenCalled();
    expect(updateGroup).toHaveBeenCalled();

    const calls = updateGroup.mock.calls.map(
      (c: unknown[]) => c[0] as { id: string; sortOrder: number },
    );
    const gBCall = calls.find((c) => c.id === "gB");
    const gCCall = calls.find((c) => c.id === "gC");
    const gACall = calls.find((c) => c.id === "gA");
    expect(gBCall).toEqual({ id: "gB", sortOrder: 0 });
    expect(gCCall).toEqual({ id: "gC", sortOrder: 1 });
    expect(gACall).toEqual({ id: "gA", sortOrder: 2 });
  });

  it("nests dragged group into target when dropped on middle band", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gAWrapper = getGroupWrapper(container, "Alpha");
    const gBWrapper = getGroupWrapper(container, "Beta");

    // Drag gA onto gB middle band → nest.
    fireDragEvent(gAWrapper, "dragStart", { dataTransfer: makeDT() });
    fireDragEvent(gBWrapper, "dragOver", {
      clientY: 20,
      dataTransfer: makeDT(),
    });
    fireDragEvent(gBWrapper, "drop", { clientY: 20, dataTransfer: makeDT() });

    expect(updateGroup).not.toHaveBeenCalled();
    expect(moveGroup).toHaveBeenCalledTimes(1);
    expect(moveGroup).toHaveBeenCalledWith({
      id: "gA",
      newParentGroupId: "gB",
    });
  });

  it("rejects cycle when dropping a group onto its descendant", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gAWrapper = getGroupWrapper(container, "Alpha");
    const gA1Wrapper = getGroupWrapper(container, "AlphaChild");

    // Drag gA onto gA1 (descendant of gA) middle band → hook returns null.
    fireDragEvent(gAWrapper, "dragStart", { dataTransfer: makeDT() });
    fireDragEvent(gA1Wrapper, "dragOver", {
      clientY: 20,
      dataTransfer: makeDT(),
    });
    fireDragEvent(gA1Wrapper, "drop", {
      clientY: 20,
      dataTransfer: makeDT(),
    });

    expect(moveGroup).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("no-op when a group is dropped onto itself", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gAWrapper = getGroupWrapper(container, "Alpha");

    fireDragEvent(gAWrapper, "dragStart", { dataTransfer: makeDT() });
    fireDragEvent(gAWrapper, "dragOver", {
      clientY: 20,
      dataTransfer: makeDT(),
    });
    fireDragEvent(gAWrapper, "drop", { clientY: 20, dataTransfer: makeDT() });

    expect(moveGroup).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("moves nested group to root when dropped on whitespace of the outer container", () => {
    const updateGroup = vi.fn(async () => {});
    const moveGroup = vi.fn(async () => {});
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar {...makeProps()} />,
      { tree: makeTreeOverride(updateGroup, moveGroup) },
    );

    const gA1Wrapper = getGroupWrapper(container, "AlphaChild");
    // Outermost container is the top-level <div className="flex flex-col ...">
    // rendered as container.firstElementChild (happy-dom wraps renders in a
    // plain host node; firstElementChild is our returned root).
    const outer = container.firstElementChild as HTMLElement;
    if (!outer) throw new Error("outer container not found");

    fireDragEvent(gA1Wrapper, "dragStart", { dataTransfer: makeDT() });
    // Fire the dragOver/drop with target === currentTarget by dispatching
    // directly on `outer`. fireEvent dispatches with target=currentTarget when
    // there's no nested element involved.
    fireDragEvent(outer, "dragOver", { dataTransfer: makeDT() });
    fireDragEvent(outer, "drop", { dataTransfer: makeDT() });

    expect(moveGroup).toHaveBeenCalledTimes(1);
    expect(moveGroup).toHaveBeenCalledWith({
      id: "gA1",
      newParentGroupId: null,
    });
    expect(updateGroup).not.toHaveBeenCalled();
  });
});
