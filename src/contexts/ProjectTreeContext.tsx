"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api-fetch";
import { PreferencesContext } from "@/contexts/PreferencesContext";

export type NodeType = "group" | "project";

export interface GroupNode {
  id: string;
  name: string;
  parentGroupId: string | null;
  collapsed: boolean;
  sortOrder: number;
}

export interface ProjectNode {
  id: string;
  name: string;
  /** Null means the project lives at the tree root alongside top-level groups. */
  groupId: string | null;
  isAutoCreated: boolean;
  sortOrder: number;
  collapsed: boolean;
}

export interface ActiveNode {
  id: string;
  type: NodeType;
}

export interface ProjectTreeContextValue {
  groups: GroupNode[];
  projects: ProjectNode[];
  isLoading: boolean;
  activeNode: ActiveNode | null;
  getGroup(id: string): GroupNode | undefined;
  getProject(id: string): ProjectNode | undefined;
  getChildrenOfGroup(groupId: string | null): {
    groups: GroupNode[];
    projects: ProjectNode[];
  };
  createGroup(input: { name: string; parentGroupId: string | null }): Promise<GroupNode>;
  updateGroup(input: {
    id: string;
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
  }): Promise<void>;
  deleteGroup(id: string, force?: boolean): Promise<void>;
  moveGroup(input: { id: string; newParentGroupId: string | null }): Promise<void>;
  createProject(input: { groupId: string | null; name: string }): Promise<ProjectNode>;
  updateProject(input: {
    id: string;
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
  }): Promise<void>;
  deleteProject(id: string): Promise<void>;
  moveProject(input: { id: string; newGroupId: string | null }): Promise<void>;
  setActiveNode(node: ActiveNode): Promise<void>;
  refresh(): Promise<void>;
}

export const ProjectTreeContext = createContext<ProjectTreeContextValue | null>(null);

export function ProjectTreeProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [activeNode, setActiveNodeState] = useState<ActiveNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // PreferencesContext caches the folders + node-preferences maps it uses to
  // resolve a session's working dir / agent provider. Those maps load once on
  // mount, so a project created/updated/moved/deleted AFTER page load is
  // invisible to preference resolution until a refetch.
  //
  // Consumed OPTIONALLY (not via the throwing `usePreferencesContext`): both
  // production ProjectTreeProvider mount sites nest inside PreferencesProvider,
  // but some tests render ProjectTreeProvider standalone — the null-safe read
  // lets those keep working (the refresh is simply skipped when the provider
  // is absent). (remote-dev-u84s)
  const preferences = useContext(PreferencesContext);
  const refreshPreferences = preferences?.refreshPreferences;

  const refresh = useCallback(async () => {
    const [groupsRes, projectsRes] = await Promise.all([
      apiFetch("/api/groups").then((r) => r.json()),
      apiFetch("/api/projects").then((r) => r.json()),
    ]);
    setGroups(groupsRes.groups ?? []);
    setProjects(projectsRes.projects ?? []);
    setIsLoading(false);
  }, []);

  // Every tree mutation refreshes both the tree and the preferences cache, so a
  // node touched after page load is immediately visible to preference
  // resolution. The two refreshes hit independent endpoints and independent
  // state, so they run in parallel. Kept out of the mount-time `refresh()` to
  // avoid double-fetching with PreferencesContext's own mount load.
  // (remote-dev-u84s)
  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshPreferences?.()]);
  }, [refresh, refreshPreferences]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load on mount
    void refresh();
  }, [refresh]);

  const getGroup = useCallback((id: string) => groups.find((g) => g.id === id), [groups]);
  const getProject = useCallback((id: string) => projects.find((p) => p.id === id), [projects]);
  const getChildrenOfGroup = useCallback(
    (groupId: string | null) => ({
      groups: groups
        .filter((g) => g.parentGroupId === groupId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      // When `groupId` is null we return projects that live at the tree root
      // (i.e. have `groupId === null`), alongside top-level groups.
      projects: projects
        .filter((p) => (p.groupId ?? null) === groupId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }),
    [groups, projects],
  );

  const createGroup: ProjectTreeContextValue["createGroup"] = useCallback(
    async (input) => {
      const res = await apiFetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          sortOrder: groups.filter((g) => g.parentGroupId === input.parentGroupId).length,
        }),
      });
      const body = await res.json();
      await refreshAll();
      return body.group as GroupNode;
    },
    [groups, refreshAll],
  );

  const updateGroup: ProjectTreeContextValue["updateGroup"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await apiFetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const deleteGroup: ProjectTreeContextValue["deleteGroup"] = useCallback(
    async (id, force) => {
      const url = force ? `/api/groups/${id}?force=true` : `/api/groups/${id}`;
      await fetch(url, { method: "DELETE" });
      await refreshAll();
    },
    [refreshAll],
  );

  const moveGroup: ProjectTreeContextValue["moveGroup"] = useCallback(
    async (input) => {
      await apiFetch(`/api/groups/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newParentGroupId: input.newParentGroupId }),
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const createProject: ProjectTreeContextValue["createProject"] = useCallback(
    async (input) => {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      await refreshAll();
      return body.project as ProjectNode;
    },
    [refreshAll],
  );

  const updateProject: ProjectTreeContextValue["updateProject"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const deleteProject: ProjectTreeContextValue["deleteProject"] = useCallback(
    async (id) => {
      await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      await refreshAll();
    },
    [refreshAll],
  );

  const moveProject: ProjectTreeContextValue["moveProject"] = useCallback(
    async (input) => {
      await apiFetch(`/api/projects/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newGroupId: input.newGroupId }),
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const setActiveNode: ProjectTreeContextValue["setActiveNode"] = useCallback(async (node) => {
    setActiveNodeState(node);
    await apiFetch("/api/preferences/active-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, nodeType: node.type }),
    });
  }, []);

  const value = useMemo<ProjectTreeContextValue>(
    () => ({
      groups,
      projects,
      isLoading,
      activeNode,
      getGroup,
      getProject,
      getChildrenOfGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      moveGroup,
      createProject,
      updateProject,
      deleteProject,
      moveProject,
      setActiveNode,
      refresh,
    }),
    [
      groups,
      projects,
      isLoading,
      activeNode,
      getGroup,
      getProject,
      getChildrenOfGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      moveGroup,
      createProject,
      updateProject,
      deleteProject,
      moveProject,
      setActiveNode,
      refresh,
    ],
  );

  return <ProjectTreeContext.Provider value={value}>{children}</ProjectTreeContext.Provider>;
}

export function useProjectTree(): ProjectTreeContextValue {
  const ctx = useContext(ProjectTreeContext);
  if (!ctx) throw new Error("useProjectTree must be used inside ProjectTreeProvider");
  return ctx;
}
