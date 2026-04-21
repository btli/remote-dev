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
  groupId: string;
  isAutoCreated: boolean;
  sortOrder: number;
  /**
   * Legacy folder id that this project was migrated from, if any. Present so
   * client code can fall back to folder-scoped APIs during the Phase 4
   * transition when a node-scoped endpoint isn't available yet.
   */
  legacyFolderId?: string | null;
}

export interface ActiveNode {
  id: string;
  type: NodeType;
}

interface ProjectTreeContextValue {
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
  updateGroup(input: { id: string; name?: string; collapsed?: boolean }): Promise<void>;
  deleteGroup(id: string, force?: boolean): Promise<void>;
  moveGroup(input: { id: string; newParentGroupId: string | null }): Promise<void>;
  createProject(input: { groupId: string; name: string }): Promise<ProjectNode>;
  updateProject(input: { id: string; name?: string; collapsed?: boolean }): Promise<void>;
  deleteProject(id: string): Promise<void>;
  moveProject(input: { id: string; newGroupId: string }): Promise<void>;
  setActiveNode(node: ActiveNode): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<ProjectTreeContextValue | null>(null);

export function ProjectTreeProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [activeNode, setActiveNodeState] = useState<ActiveNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [groupsRes, projectsRes] = await Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ]);
    setGroups(groupsRes.groups ?? []);
    setProjects(projectsRes.projects ?? []);
    setIsLoading(false);
  }, []);

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
      projects: groupId
        ? projects.filter((p) => p.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    }),
    [groups, projects],
  );

  const createGroup: ProjectTreeContextValue["createGroup"] = useCallback(
    async (input) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          sortOrder: groups.filter((g) => g.parentGroupId === input.parentGroupId).length,
        }),
      });
      const body = await res.json();
      await refresh();
      return body.group as GroupNode;
    },
    [groups, refresh],
  );

  const updateGroup: ProjectTreeContextValue["updateGroup"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await fetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refresh();
    },
    [refresh],
  );

  const deleteGroup: ProjectTreeContextValue["deleteGroup"] = useCallback(
    async (id, force) => {
      const url = force ? `/api/groups/${id}?force=true` : `/api/groups/${id}`;
      await fetch(url, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const moveGroup: ProjectTreeContextValue["moveGroup"] = useCallback(
    async (input) => {
      await fetch(`/api/groups/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newParentGroupId: input.newParentGroupId }),
      });
      await refresh();
    },
    [refresh],
  );

  const createProject: ProjectTreeContextValue["createProject"] = useCallback(
    async (input) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      await refresh();
      return body.project as ProjectNode;
    },
    [refresh],
  );

  const updateProject: ProjectTreeContextValue["updateProject"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refresh();
    },
    [refresh],
  );

  const deleteProject: ProjectTreeContextValue["deleteProject"] = useCallback(
    async (id) => {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const moveProject: ProjectTreeContextValue["moveProject"] = useCallback(
    async (input) => {
      await fetch(`/api/projects/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newGroupId: input.newGroupId }),
      });
      await refresh();
    },
    [refresh],
  );

  const setActiveNode: ProjectTreeContextValue["setActiveNode"] = useCallback(async (node) => {
    setActiveNodeState(node);
    await fetch("/api/preferences/active-node", {
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

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectTree(): ProjectTreeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjectTree must be used inside ProjectTreeProvider");
  return ctx;
}
