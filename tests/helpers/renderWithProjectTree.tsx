import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement, type ContextType } from "react";
import {
  ProjectTreeContext,
  type GroupNode,
  type ProjectNode,
} from "@/contexts/ProjectTreeContext";

type CtxValue = NonNullable<ContextType<typeof ProjectTreeContext>>;

function stub(): CtxValue {
  return {
    groups: [],
    projects: [],
    isLoading: false,
    activeNode: null,
    getGroup: () => undefined,
    getProject: () => undefined,
    getChildrenOfGroup: () => ({ groups: [], projects: [] }),
    createGroup: async () => ({}) as GroupNode,
    updateGroup: async () => {},
    deleteGroup: async () => {},
    moveGroup: async () => {},
    createProject: async () => ({}) as ProjectNode,
    updateProject: async () => {},
    deleteProject: async () => {},
    moveProject: async () => {},
    setActiveNode: async () => {},
    refresh: async () => {},
  };
}

export function renderWithProjectTree(
  ui: ReactElement,
  { tree, ...opts }: { tree?: Partial<CtxValue> } & RenderOptions = {},
) {
  const value: CtxValue = { ...stub(), ...tree };
  return render(
    <ProjectTreeContext.Provider value={value}>{ui}</ProjectTreeContext.Provider>,
    opts,
  );
}
