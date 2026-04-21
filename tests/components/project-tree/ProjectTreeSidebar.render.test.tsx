import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";

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

const group = {
  id: "g1",
  name: "Workspace",
  parentGroupId: null,
  collapsed: false,
  sortOrder: 0,
};
const project = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

describe("ProjectTreeSidebar", () => {
  it("renders group > project > session hierarchy", () => {
    const { getByText } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
      />,
      {
        tree: {
          groups: [group],
          projects: [project as any],
          getGroup: (id: string) => (id === "g1" ? group : undefined),
          getProject: (id: string) => (id === "p1" ? (project as any) : undefined),
          getChildrenOfGroup: (gid: string | null) =>
            gid === null
              ? { groups: [group], projects: [] }
              : gid === "g1"
              ? { groups: [], projects: [project as any] }
              : { groups: [], projects: [] },
        },
      }
    );
    expect(getByText("Workspace")).toBeInTheDocument();
    expect(getByText("app")).toBeInTheDocument();
    expect(getByText("server")).toBeInTheDocument();
  });
});
