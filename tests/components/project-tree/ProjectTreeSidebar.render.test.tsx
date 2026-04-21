import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

// Mock the ancillary contexts BEFORE importing the component-under-test's children
vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [
      { id: "s1", name: "server", projectId: "p1", status: "running", terminalType: "shell", pinned: false },
    ],
    activeSessionId: null,
    getAgentActivityStatus: () => "idle",
  }),
}));

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    getFolderPreferences: () => null,
  }),
}));

vi.mock("@/contexts/SecretsContext", () => ({
  useSecretsContext: () => ({
    folderConfigs: new Map(),
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
  legacyFolderId: "f1",
};

/** No-op props for all new required handlers */
const requiredHandlerProps = {
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
};

const treeOverride = {
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

describe("ProjectTreeSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders group > project > session hierarchy", () => {
    const { getByText } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree: treeOverride }
    );
    expect(getByText("Workspace")).toBeInTheDocument();
    expect(getByText("app")).toBeInTheDocument();
    expect(getByText("server")).toBeInTheDocument();
  });

  it("renders without crashing when wrapping all rows with context menus", () => {
    const { container } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree: treeOverride }
    );
    expect(container).toBeTruthy();
  });
});
