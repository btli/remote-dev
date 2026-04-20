"use client";

/**
 * Compatibility shim for legacy FolderContext consumers.
 *
 * Phase 6 consolidated the two-level (group + project) hierarchy into
 * ProjectTreeContext. Components that still speak the old "folder" vocabulary
 * use this shim; it flattens groups+projects into a single list and maps
 * folder operations onto their group/project equivalents.
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  useProjectTree,
  type GroupNode,
  type ProjectNode,
} from "./ProjectTreeContext";

/**
 * FolderProvider is a legacy alias. The real provider is ProjectTreeProvider,
 * mounted separately in the app tree. This shim exists purely so legacy
 * imports continue to compile; it simply renders its children.
 */
export function FolderProvider({
  children,
}: {
  children: ReactNode;
  // Legacy props accepted for call-site compatibility, but unused.
  initialFolders?: unknown;
  initialSessionFolders?: unknown;
}) {
  return <>{children}</>;
}

export interface LegacyFolder {
  id: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  // discriminator so callers can distinguish when they need to
  kind: "group" | "project";
}

function flattenToFolders(
  groups: GroupNode[],
  projects: ProjectNode[]
): LegacyFolder[] {
  const out: LegacyFolder[] = [];
  for (const g of groups) {
    out.push({
      id: g.id,
      parentId: g.parentGroupId,
      name: g.name,
      collapsed: g.collapsed,
      sortOrder: g.sortOrder,
      kind: "group",
    });
  }
  for (const p of projects) {
    out.push({
      id: p.id,
      parentId: p.groupId,
      name: p.name,
      collapsed: false,
      sortOrder: p.sortOrder,
      kind: "project",
    });
  }
  return out;
}

export function useFolderContext() {
  const tree = useProjectTree();

  const folders = useMemo(
    () => flattenToFolders(tree.groups, tree.projects),
    [tree.groups, tree.projects]
  );

  // Registration map used by legacy code to associate a freshly created
  // session with a folder id before the server round-trip lands. We stash it
  // on a ref to stay compatible but do not persist anywhere — sessions carry
  // their own projectId from the server.
  const pendingMap = useRef(new Map<string, string>());
  const registerSessionFolder = useCallback((sessionId: string, folderId: string) => {
    pendingMap.current.set(sessionId, folderId);
  }, []);

  const debouncedRefreshFolders = useCallback(() => {
    void tree.refresh();
  }, [tree]);

  const createFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      // Legacy consumers always created "folders" under a parent folder. In
      // the new world these are groups by default (empty grouping containers).
      return tree.createGroup({ name, parentGroupId: parentId });
    },
    [tree]
  );

  const updateFolder = useCallback(
    async (folderId: string, updates: { name?: string; collapsed?: boolean }) => {
      const group = tree.getGroup(folderId);
      if (group) {
        await tree.updateGroup({ id: folderId, ...updates });
        return;
      }
      const project = tree.getProject(folderId);
      if (project) {
        await tree.updateProject({ id: folderId, ...updates });
      }
    },
    [tree]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const group = tree.getGroup(folderId);
      if (group) {
        await tree.deleteGroup(folderId, true);
        return;
      }
      await tree.deleteProject(folderId);
    },
    [tree]
  );

  const toggleFolder = useCallback(
    async (folderId: string) => {
      const group = tree.getGroup(folderId);
      if (group) {
        await tree.updateGroup({ id: folderId, collapsed: !group.collapsed });
      }
    },
    [tree]
  );

  const moveFolderToParent = useCallback(
    async (folderId: string, newParentId: string | null) => {
      const group = tree.getGroup(folderId);
      if (group) {
        await tree.moveGroup({ id: folderId, newParentGroupId: newParentId });
        return;
      }
      const project = tree.getProject(folderId);
      if (project && newParentId) {
        await tree.moveProject({ id: folderId, newGroupId: newParentId });
      }
    },
    [tree]
  );

  const reorderFolders = useCallback(async (_folderIds: string[]) => {
    // Reordering support is tree.updateGroup/updateProject sortOrder per node;
    // the legacy API wasn't fully wired up either — noop is acceptable until
    // a Phase 6 follow-up restores explicit reorder semantics.
  }, []);

  const moveSessionToFolder = useCallback(
    async (sessionId: string, folderId: string | null) => {
      const response = await fetch(`/api/sessions/${sessionId}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: folderId }),
      });
      if (!response.ok) {
        throw new Error(`Failed to move session: ${response.status}`);
      }
    },
    []
  );

  return {
    folders,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolder,
    moveSessionToFolder,
    moveFolderToParent,
    reorderFolders,
    registerSessionFolder,
    debouncedRefreshFolders,
  };
}
