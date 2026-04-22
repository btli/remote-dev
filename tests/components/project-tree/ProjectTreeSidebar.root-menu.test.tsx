import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { act } from "@testing-library/react";
import { renderWithProjectTree } from "../../helpers/renderWithProjectTree";
import {
  ProjectTreeSidebar,
  type ProjectTreeSidebarHandle,
} from "@/components/session/ProjectTreeSidebar";

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [],
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

describe("ProjectTreeSidebar imperative handle (root-create)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startCreateGroupAtRoot opens an inline group-create input at root", () => {
    const ref = createRef<ProjectTreeSidebarHandle>();
    const { getByPlaceholderText, queryByPlaceholderText } = renderWithProjectTree(
      <ProjectTreeSidebar
        ref={ref}
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree: { groups: [], projects: [] } },
    );
    // No inline input yet
    expect(queryByPlaceholderText(/new group/i)).toBeNull();
    act(() => {
      ref.current?.startCreateGroupAtRoot();
    });
    expect(getByPlaceholderText(/new group/i)).toBeInTheDocument();
  });

  it("startCreateProjectAtRoot opens an inline project-create input at root", () => {
    const ref = createRef<ProjectTreeSidebarHandle>();
    const { getByPlaceholderText, queryByPlaceholderText } = renderWithProjectTree(
      <ProjectTreeSidebar
        ref={ref}
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
        onSessionRename={() => {}}
        {...requiredHandlerProps}
      />,
      { tree: { groups: [], projects: [] } },
    );
    expect(queryByPlaceholderText(/new project/i)).toBeNull();
    act(() => {
      ref.current?.startCreateProjectAtRoot();
    });
    expect(getByPlaceholderText(/new project/i)).toBeInTheDocument();
  });
});
