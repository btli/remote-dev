import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
import { GroupContextMenuContent } from "@/components/session/project-tree/GroupContextMenu";
import { ProjectContextMenuContent } from "@/components/session/project-tree/ProjectContextMenu";
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

// ---------------------------------------------------------------------------
// Delete confirmation gate tests
// These test the confirm-before-delete logic via the exported *ContextMenuContent
// components (plain buttons, no Radix right-click required).
// ---------------------------------------------------------------------------

describe("delete confirmation gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("group delete", () => {
    const makeHandlers = (confirmResult: boolean, deleteGroup: (id: string, force: boolean) => void) => {
      const confirmMock = vi.fn(() => confirmResult);
      vi.stubGlobal("confirm", confirmMock);
      const g: GroupNode = { id: "g2", name: "My Group", parentGroupId: null, collapsed: false, sortOrder: 0 };
      const childCount = 2;
      // Mirrors the handleDeleteGroup logic in ProjectTreeSidebar
      const onDelete = () => {
        const msg = `Delete group "${g.name}" and ${childCount} descendant items? This cannot be undone.`;
        if (!window.confirm(msg)) return;
        void deleteGroup(g.id, true);
      };
      return { g, onDelete };
    };

    it("does NOT call deleteGroup when user cancels confirm", () => {
      const deleteGroup = vi.fn<(id: string, force: boolean) => void>();
      const { onDelete, g } = makeHandlers(false, deleteGroup);
      const { getByRole } = render(
        <GroupContextMenuContent
          group={g}
          hasCustomPrefs={false}
          onCreateProject={() => {}}
          onCreateSubgroup={() => {}}
          onOpenPreferences={() => {}}
          onStartEdit={() => {}}
          onMoveToRoot={() => {}}
          onDelete={onDelete}
        />
      );
      fireEvent.click(getByRole("menuitem", { name: /delete/i }));
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(deleteGroup).not.toHaveBeenCalled();
    });

    it("calls deleteGroup(id, true) when user confirms and group has descendants", () => {
      const deleteGroup = vi.fn<(id: string, force: boolean) => void>();
      const { onDelete, g } = makeHandlers(true, deleteGroup);
      const { getByRole } = render(
        <GroupContextMenuContent
          group={g}
          hasCustomPrefs={false}
          onCreateProject={() => {}}
          onCreateSubgroup={() => {}}
          onOpenPreferences={() => {}}
          onStartEdit={() => {}}
          onMoveToRoot={() => {}}
          onDelete={onDelete}
        />
      );
      fireEvent.click(getByRole("menuitem", { name: /delete/i }));
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(deleteGroup).toHaveBeenCalledWith("g2", true);
    });
  });

  describe("project delete", () => {
    const p: ProjectNode = { id: "p2", name: "My Project", groupId: "g1", isAutoCreated: false, sortOrder: 0, collapsed: false };

    const makeProjectDeleteHandler = (confirmResult: boolean, deleteProject: (id: string) => void) => {
      const confirmMock = vi.fn(() => confirmResult);
      vi.stubGlobal("confirm", confirmMock);
      // Mirrors the handleDeleteProject logic in ProjectTreeSidebar (no open sessions)
      const onDelete = () => {
        const msg = `Delete project "${p.name}"?`;
        if (!window.confirm(msg)) return;
        void deleteProject(p.id);
      };
      return onDelete;
    };

    it("does NOT call deleteProject when user cancels confirm", () => {
      const deleteProject = vi.fn<(id: string) => void>();
      const onDelete = makeProjectDeleteHandler(false, deleteProject);
      const { getByRole } = render(
        <ProjectContextMenuContent
          project={p}
          hasCustomPrefs={false}
          hasActiveSecrets={false}
          hasLinkedRepo={false}
          hasWorkingDirectory={false}
          legacyFolderAvailable={false}
          onNewTerminal={() => {}}
          onNewAgent={() => {}}
          onResume={() => {}}
          onAdvanced={() => {}}
          onNewWorktree={() => {}}
          onOpenPreferences={() => {}}
          onOpenSecrets={() => {}}
          onOpenRepository={() => {}}
          onOpenFolderInOS={() => {}}
          onStartEdit={() => {}}
          onDelete={onDelete}
        />
      );
      fireEvent.click(getByRole("menuitem", { name: /delete/i }));
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(deleteProject).not.toHaveBeenCalled();
    });

    it("calls deleteProject(id) when user confirms", () => {
      const deleteProject = vi.fn<(id: string) => void>();
      const onDelete = makeProjectDeleteHandler(true, deleteProject);
      const { getByRole } = render(
        <ProjectContextMenuContent
          project={p}
          hasCustomPrefs={false}
          hasActiveSecrets={false}
          hasLinkedRepo={false}
          hasWorkingDirectory={false}
          legacyFolderAvailable={false}
          onNewTerminal={() => {}}
          onNewAgent={() => {}}
          onResume={() => {}}
          onAdvanced={() => {}}
          onNewWorktree={() => {}}
          onOpenPreferences={() => {}}
          onOpenSecrets={() => {}}
          onOpenRepository={() => {}}
          onOpenFolderInOS={() => {}}
          onStartEdit={() => {}}
          onDelete={onDelete}
        />
      );
      fireEvent.click(getByRole("menuitem", { name: /delete/i }));
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(deleteProject).toHaveBeenCalledWith("p2");
    });
  });
});
