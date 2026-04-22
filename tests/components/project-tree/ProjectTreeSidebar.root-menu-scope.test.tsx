/**
 * ProjectTreeSidebar — RootContextMenu scoping.
 *
 * Covers remote-dev-nmw4 codex Finding 3: the root-level "New Group / New
 * Project" context menu must NOT wrap the whole tree container (which would
 * compete with row-level context menus on right-clicks). Instead it wraps a
 * dedicated trailing whitespace filler element.
 *
 * These tests assert the structural contract:
 *   1. The tree container itself (data-testid="project-tree-root") is NOT
 *      a Radix ContextMenuTrigger — it does not have a
 *      `data-state` attribute and is not the direct descendant of the
 *      menu wrapper.
 *   2. The filler (`project-tree-root-filler`) exists, grows, and serves
 *      as the dedicated affordance for right-click-empty-space.
 */
import { describe, it, expect, vi } from "vitest";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [
      {
        id: "s1",
        name: "server",
        projectId: "p1",
        status: "running",
        terminalType: "shell",
        pinned: false,
      },
    ],
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
  useNotificationContext: () => ({
    notifications: [],
  }),
}));

const group: GroupNode = {
  id: "g1",
  name: "Workspace",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};
const project: ProjectNode = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

const requiredHandlerProps = {
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
};

const tree = {
  groups: [group],
  projects: [project],
  getGroup: (id: string) => (id === "g1" ? group : undefined),
  getProject: (id: string) => (id === "p1" ? project : undefined),
  getChildrenOfGroup: (gid: string | null) =>
    gid === null
      ? { groups: [group], projects: [] }
      : gid === "g1"
      ? { groups: [], projects: [project] }
      : { groups: [], projects: [] },
};

describe("ProjectTreeSidebar — RootContextMenu scoping", () => {
  it("renders a dedicated whitespace filler for the root context menu", () => {
    const { getByTestId } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree },
    );
    const filler = getByTestId("project-tree-root-filler");
    expect(filler).toBeInTheDocument();
    // Filler should grow and have a minimum height so empty-space clicks
    // always have a target.
    expect(filler.className).toMatch(/flex-1/);
    expect(filler.className).toMatch(/min-h-\[40px\]/);
  });

  it("does NOT make the tree container a context-menu trigger (row menus win)", () => {
    const { getByTestId } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree },
    );
    const root = getByTestId("project-tree-root");
    // Radix ContextMenuTrigger sets data-state on its rendered child; if
    // the root container had been wrapped as the trigger, this attribute
    // would exist. It must NOT.
    expect(root.getAttribute("data-state")).toBeNull();
  });

  it("places the filler AFTER the group/project rows so rows intercept first", () => {
    const { getByTestId, getByText } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree },
    );
    const filler = getByTestId("project-tree-root-filler");
    const groupRow = getByText("Workspace");
    const pos = groupRow.compareDocumentPosition(filler);
    // Bit 4 == DOCUMENT_POSITION_FOLLOWING — filler must follow the group row.
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
