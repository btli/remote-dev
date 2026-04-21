"use client";
import { useMemo, useState } from "react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { GroupRow } from "./project-tree/GroupRow";
import { ProjectRow } from "./project-tree/ProjectRow";
import { SessionRow } from "./project-tree/SessionRow";
import { TreeConnector } from "./project-tree/TreeConnector";
import { CreateNodeInline } from "./project-tree/CreateNodeInline";
import { GroupContextMenu } from "./project-tree/GroupContextMenu";
import { ProjectContextMenu } from "./project-tree/ProjectContextMenu";
import { SessionContextMenu } from "./project-tree/SessionContextMenu";
import {
  useTreeDragDrop,
  type DragState,
  type DropIndicator,
} from "./project-tree/useTreeDragDrop";
import { useTreeTouchDrag } from "./project-tree/useTreeTouchDrag";
import { useSwipeToClose } from "./project-tree/useSwipeToClose";
import { useMobile } from "@/hooks/useMobile";
import {
  recursiveSessionCount,
  rolledUpRepoStats,
  sessionsForProject,
  type RepoStats,
} from "@/lib/project-tree-session-utils";
import type { TerminalSession } from "@/types/session";
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

interface Props {
  getProjectRepoStats: (projectId: string) => RepoStats | null;
  onOpenPreferences?: (node: {
    id: string;
    type: "group" | "project";
    name: string;
  }) => void;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionStartEdit: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  // Project handlers — all take `projectId` (i.e. the project's `id`, which
  // is what node-scoped backend APIs key on). This replaces the former
  // `legacyFolderId` contract; see remote-dev-oqol.4.1 / remote-dev-w1ed.
  onProjectNewSession: (projectId: string) => void;
  onProjectNewAgent: (projectId: string) => void;
  onProjectResumeClaudeSession: (projectId: string) => void;
  onProjectAdvancedSession: (projectId: string) => void;
  onProjectNewWorktree: (projectId: string) => void;
  onProjectOpenSecrets: (projectId: string) => void;
  onProjectOpenRepository: (projectId: string, name: string) => void;
  onProjectOpenFolderInOS: (projectId: string) => void;
  onProjectViewIssues?: (projectId: string) => void;
  onProjectViewPRs?: (projectId: string) => void;
  // Session handlers. `onSessionMove` takes the target project's `id` (or
  // null for the legacy no-project slot). The backend
  // /api/sessions/:id/folder route accepts `projectId` as of Phase G0a.
  onSessionTogglePin: (sessionId: string) => void;
  onSessionMove: (sessionId: string, projectId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;
  onSessionSchedule?: (sessionId: string) => void;
}

export function ProjectTreeSidebar(props: Props) {
  const tree = useProjectTree();
  const [editingNode, setEditingNode] = useState<{ id: string; type: "group" | "project" | "session" } | null>(null);
  const [creating, setCreating] = useState<{ parentGroupId: string | null; kind: "group" | "project" } | null>(null);
  const { sessions, activeSessionId, getAgentActivityStatus } = useSessionContext();
  const { getNodePreferences, hasNodePreferences } = usePreferencesContext();
  const { nodeHasActiveSecrets } = useSecretsContext();
  const { notifications } = useNotificationContext();

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== "closed"),
    [sessions]
  );

  // Phase E2: drag-and-drop state. Sessions can be dragged to reorder within
  // their project, or dropped onto a project row to move cross-project. The
  // hook itself is pure — we compute descendant-group closures for cycle
  // guards (group drag is Phase E3 but the hook still requires the callback).
  const dnd = useTreeDragDrop({
    collectDescendantGroupIds: (rootId) => {
      const out = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const g of tree.groups) {
          if (g.parentGroupId === cur && !out.has(g.id)) {
            out.add(g.id);
            stack.push(g.id);
          }
        }
      }
      return out;
    },
  });

  const indicatorFor = (
    type: "session" | "project" | "group",
    id: string,
  ): "before" | "after" | "nest" | null => {
    const ind = dnd.indicator;
    if (!ind) return null;
    if (ind.targetType !== type) return null;
    if (ind.targetId !== id) return null;
    return ind.position;
  };

  const sessionUnread = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notifications) {
      if (n.readAt == null && n.sessionId) {
        m.set(n.sessionId, (m.get(n.sessionId) ?? 0) + 1);
      }
    }
    return m;
  }, [notifications]);

  // Project options for session move submenu
  const projectOptions = useMemo(
    () => tree.projects.map((p) => ({ id: p.id, name: p.name })),
    [tree.projects]
  );

  // Predicates — node-keyed by project.id. The backend
  // `node_preferences` / `project_secrets_config` tables are both keyed by
  // project.id, so we no longer need the legacy_folder_id indirection.
  const hasCustomPrefs = (p: ProjectNode): boolean =>
    hasNodePreferences("project", p.id);

  const hasLinkedRepo = (p: ProjectNode): boolean =>
    getNodePreferences("project", p.id)?.githubRepoId != null;

  const hasActiveSecrets = (p: ProjectNode): boolean =>
    nodeHasActiveSecrets("project", p.id);

  const hasWorkingDirectory = (p: ProjectNode): boolean =>
    getNodePreferences("project", p.id)?.defaultWorkingDirectory != null;

  // Delete helpers with confirmation prompts
  const handleDeleteGroup = (g: GroupNode) => {
    const { groups: childGroups, projects: childProjects } = tree.getChildrenOfGroup(g.id);
    const childCount = childGroups.length + childProjects.length;
    const msg =
      childCount > 0
        ? `Delete group "${g.name}" and ${childCount} descendant ${childCount === 1 ? "item" : "items"}? This cannot be undone.`
        : `Delete group "${g.name}"?`;
    if (!window.confirm(msg)) return;
    void tree.deleteGroup(g.id, childCount > 0);
  };

  const handleDeleteProject = (p: ProjectNode) => {
    const sessionCount = sessionsForProject(activeSessions, p.id, {
      excludeFileSessions: true,
    }).length;
    const msg =
      sessionCount > 0
        ? `Delete project "${p.name}" and close ${sessionCount} open ${sessionCount === 1 ? "session" : "sessions"}? This cannot be undone.`
        : `Delete project "${p.name}"?`;
    if (!window.confirm(msg)) return;
    void tree.deleteProject(p.id);
  };

  // Handle drop of a session row on another session row. Same-project +
  // same-pin partition → reorder within the partition; otherwise route to the
  // cross-project move path (for defensive consistency, though the hook's
  // indicator guards should prevent that case).
  const handleSessionDropOnSession = (
    snap: { drag: DragState; indicator: DropIndicator },
    targetSession: TerminalSession,
  ) => {
    const { drag, indicator } = snap;
    if (drag.type !== "session") return;
    if (indicator.targetType !== "session") return;

    const draggedSession = activeSessions.find((s) => s.id === drag.id);
    if (!draggedSession) return;

    const draggedFolderId = draggedSession.projectId ?? null;
    const targetFolderId = targetSession.projectId ?? null;

    if (draggedFolderId !== targetFolderId) {
      // Cross-project drop on a session row — treat as cross-project move.
      // `projectId` on a session is the destination key; pass it through
      // directly (the target project's `id`).
      props.onSessionMove(drag.id, targetFolderId);
      return;
    }

    // Same project + same pin partition — reorder within the partition and
    // rebuild the full cross-project session-id list in render order.
    const draggedPinned = draggedSession.pinned ?? false;
    const samePartition = activeSessions.filter(
      (s) =>
        (s.projectId ?? null) === targetFolderId &&
        (s.pinned ?? false) === draggedPinned,
    );
    const currentOrder = samePartition.map((s) => s.id);
    const newOrder = currentOrder.filter((id) => id !== drag.id);
    const targetIdx = newOrder.indexOf(targetSession.id);
    const insertIdx =
      indicator.position === "before" ? targetIdx : targetIdx + 1;
    newOrder.splice(insertIdx, 0, drag.id);

    const otherPartition = activeSessions
      .filter(
        (s) =>
          (s.projectId ?? null) === targetFolderId &&
          (s.pinned ?? false) !== draggedPinned,
      )
      .map((s) => s.id);

    const fullOrder: string[] = [];
    const emitProjectSlot = (projectId: string | null) => {
      if (projectId === targetFolderId) {
        if (draggedPinned) fullOrder.push(...newOrder, ...otherPartition);
        else fullOrder.push(...otherPartition, ...newOrder);
      } else {
        const pinned = activeSessions
          .filter(
            (s) => (s.projectId ?? null) === projectId && (s.pinned ?? false),
          )
          .map((s) => s.id);
        const unpinned = activeSessions
          .filter(
            (s) => (s.projectId ?? null) === projectId && !(s.pinned ?? false),
          )
          .map((s) => s.id);
        fullOrder.push(...pinned, ...unpinned);
      }
    };

    for (const p of tree.projects) emitProjectSlot(p.id);
    emitProjectSlot(null);

    props.onSessionReorder(fullOrder);
  };

  const handleSessionDropOnProject = (
    snap: { drag: DragState; indicator: DropIndicator },
    targetProject: ProjectNode,
  ) => {
    if (snap.drag.type !== "session") return;
    props.onSessionMove(snap.drag.id, targetProject.id);
  };

  const handleProjectDropOnProject = (
    snap: { drag: DragState; indicator: DropIndicator },
    targetProject: ProjectNode,
  ) => {
    const { drag, indicator } = snap;
    if (drag.type !== "project") return;
    if (indicator.targetType !== "project") return;
    if (indicator.position !== "before" && indicator.position !== "after") return;

    const sourceProject = tree.projects.find((p) => p.id === drag.id);
    if (!sourceProject) return;
    // The hook's indicator already guards cross-group drops on project rows
    // (extra.targetParentId must match drag.sourceParentId). Keep this
    // defensive same-group check too, in case the caller wiring regresses.
    if (sourceProject.groupId !== targetProject.groupId) return;

    const siblings = tree.projects
      .filter((p) => p.groupId === targetProject.groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = siblings.map((s) => s.id);
    const withoutDragged = ids.filter((id) => id !== drag.id);
    const tIdx = withoutDragged.indexOf(targetProject.id);
    const insertIdx = indicator.position === "before" ? tIdx : tIdx + 1;
    withoutDragged.splice(insertIdx, 0, drag.id);

    withoutDragged.forEach((id, idx) => {
      const current = siblings.find((s) => s.id === id);
      if (!current || current.sortOrder === idx) return;
      void tree.updateProject({ id, sortOrder: idx });
    });
  };

  const handleProjectDropOnGroup = (
    snap: { drag: DragState; indicator: DropIndicator },
    targetGroup: GroupNode,
  ) => {
    const { drag, indicator } = snap;
    if (drag.type !== "project") return;
    if (indicator.targetType !== "group" || indicator.position !== "nest") return;

    const project = tree.projects.find((p) => p.id === drag.id);
    if (!project) return;
    if (project.groupId === targetGroup.id) return;
    void tree.moveProject({ id: drag.id, newGroupId: targetGroup.id });
  };

  const handleGroupDropOnGroup = (
    snap: { drag: DragState; indicator: DropIndicator },
    targetGroup: GroupNode,
  ) => {
    const { drag, indicator } = snap;
    if (drag.type !== "group") return;
    if (indicator.targetType !== "group") return;

    if (indicator.position === "nest") {
      // Nest dragged group under target group. The hook's indicator already
      // applied the cycle check (returned null if the drop would create a
      // cycle), so if we're here the move is safe.
      if (targetGroup.id === drag.id) return;
      const source = tree.groups.find((g) => g.id === drag.id);
      if (!source) return;
      if (source.parentGroupId === targetGroup.id) return; // already nested there
      void tree.moveGroup({ id: drag.id, newParentGroupId: targetGroup.id });
      return;
    }

    // Reorder among siblings — must share parentGroupId (hook already enforced).
    const source = tree.groups.find((g) => g.id === drag.id);
    if (!source) return;
    if (source.parentGroupId !== targetGroup.parentGroupId) return;

    const siblings = tree.groups
      .filter((g) => g.parentGroupId === targetGroup.parentGroupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = siblings.map((s) => s.id);
    const withoutDragged = ids.filter((id) => id !== drag.id);
    const tIdx = withoutDragged.indexOf(targetGroup.id);
    const insertIdx = indicator.position === "before" ? tIdx : tIdx + 1;
    withoutDragged.splice(insertIdx, 0, drag.id);

    withoutDragged.forEach((id, idx) => {
      const current = siblings.find((s) => s.id === id);
      if (!current || current.sortOrder === idx) return;
      void tree.updateGroup({ id, sortOrder: idx });
    });
  };

  // Phase F1: mobile long-press touch drag. The hook is a no-op when not on
  // mobile, so instantiation is unconditional. Drops are dispatched to the
  // same handler family used by the desktop mouse drag paths.
  const isMobile = useMobile();
  const touch = useTreeTouchDrag({
    enabled: isMobile,
    startDrag: dnd.startDrag,
    dragOver: dnd.dragOver,
    drop: dnd.drop,
    cancel: dnd.cancel,
    onDropResolved: (snap) => {
      if (snap.drag.type === "group" && snap.indicator.targetType === "group") {
        const targetGroup = tree.groups.find((g) => g.id === snap.indicator.targetId);
        if (targetGroup) handleGroupDropOnGroup(snap, targetGroup);
      } else if (
        snap.drag.type === "project" &&
        snap.indicator.targetType === "project"
      ) {
        const targetProject = tree.projects.find(
          (p) => p.id === snap.indicator.targetId,
        );
        if (targetProject) handleProjectDropOnProject(snap, targetProject);
      } else if (
        snap.drag.type === "project" &&
        snap.indicator.targetType === "group"
      ) {
        const targetGroup = tree.groups.find((g) => g.id === snap.indicator.targetId);
        if (targetGroup) handleProjectDropOnGroup(snap, targetGroup);
      }
    },
  });

  // Phase F2: mobile swipe-to-close on session rows. Like touch drag, the hook
  // is a no-op on desktop.
  const swipe = useSwipeToClose({
    enabled: isMobile,
    onClose: (sid) => props.onSessionClose(sid),
    canSwipe: () => true,
  });

  if (tree.isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading projects…</div>;
  }

  const rootEntries = tree.getChildrenOfGroup(null);

  const renderSessions = (projectId: string, depth: number) => {
    const list = sessionsForProject(activeSessions, projectId) as TerminalSession[];
    const pinned = list.filter((s) => s.pinned);
    const unpinned = list.filter((s) => !s.pinned);
    const ordered = [...pinned, ...unpinned];
    return ordered.map((s, i) => (
      <TreeConnector key={s.id} depth={depth} isLastChild={i === ordered.length - 1}>
        <SessionContextMenu
          session={s}
          projects={projectOptions}
          onStartEdit={() => setEditingNode({ id: s.id, type: "session" })}
          onTogglePin={() => props.onSessionTogglePin(s.id)}
          onMove={(targetProjectId) => {
            // onSessionMove now takes the target project's `id` directly
            // (post remote-dev-oqol.4.1).
            props.onSessionMove(s.id, targetProjectId);
          }}
          onSchedule={props.onSessionSchedule ? () => props.onSessionSchedule!(s.id) : undefined}
          onClose={() => props.onSessionClose(s.id)}
        >
          <div>
            <SessionRow
              session={s}
              depth={depth}
              dropIndicator={indicatorFor("session", s.id)}
              isActive={s.id === activeSessionId}
              isEditing={editingNode?.id === s.id && editingNode?.type === "session"}
              hasUnread={(sessionUnread.get(s.id) ?? 0) > 0}
              agentStatus={s.terminalType === "agent" ? getAgentActivityStatus(s.id) : null}
              scheduleCount={0}
              dragTranslateStyle={swipe.getRowStyle(s.id)}
              swipeRevealed={swipe.swipedSessionId === s.id}
              onTouchStart={(e) => swipe.handleTouchStart(e, s.id)}
              onTouchMove={swipe.handleTouchMove}
              onTouchEnd={swipe.handleTouchEnd}
              onClick={() => props.onSessionClick(s.id)}
              onClose={() => {
                props.onSessionClose(s.id);
                swipe.clearSwipe();
              }}
              onStartEdit={() => {
                props.onSessionStartEdit(s.id);
                setEditingNode({ id: s.id, type: "session" });
              }}
              onSaveEdit={(name) => {
                props.onSessionRename(s.id, name);
                setEditingNode(null);
              }}
              onCancelEdit={() => setEditingNode(null)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", s.id);
                e.dataTransfer.setData("type", "session");
                e.dataTransfer.effectAllowed = "move";
                dnd.startDrag("session", s.id, s.projectId ?? null);
              }}
              onDragEnd={() => dnd.cancel()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                dnd.dragOver(
                  "session",
                  s.id,
                  e.clientY,
                  { top: rect.top, height: rect.height },
                  {
                    targetParentId: s.projectId ?? null,
                    draggedPinned:
                      dnd.drag?.type === "session"
                        ? activeSessions.find((x) => x.id === dnd.drag!.id)?.pinned ?? false
                        : undefined,
                    targetPinned: s.pinned ?? false,
                  },
                );
              }}
              onDragLeave={() => dnd.dragLeave()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const snap = dnd.drop("session", s.id);
                if (!snap) return;
                handleSessionDropOnSession(snap, s);
              }}
            />
          </div>
        </SessionContextMenu>
      </TreeConnector>
    ));
  };

  const renderGroupSubtree = (groupId: string, depth: number) => {
    const { groups: childGroups, projects: childProjects } = tree.getChildrenOfGroup(groupId);
    return (
      <>
        {childGroups.map((g, i) => (
          <TreeConnector
            key={g.id}
            depth={depth}
            isLastChild={i === childGroups.length - 1 && childProjects.length === 0 && creating?.parentGroupId !== groupId}
          >
            <GroupContextMenu
              group={g}
              hasCustomPrefs={hasNodePreferences("group", g.id)}
              onCreateProject={() => setCreating({ parentGroupId: g.id, kind: "project" })}
              onCreateSubgroup={() => setCreating({ parentGroupId: g.id, kind: "group" })}
              onOpenPreferences={
                props.onOpenPreferences
                  ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                  : () => {}
              }
              onStartEdit={() => setEditingNode({ id: g.id, type: "group" })}
              onMoveToRoot={() => void tree.moveGroup({ id: g.id, newParentGroupId: null })}
              onDelete={() => handleDeleteGroup(g)}
            >
              <div
                draggable
                onDragStart={(e) => {
                  // Only register this as a group drag if the dragstart originated
                  // on the wrapper itself, not bubbled up from a nested ProjectRow
                  // or SessionRow inside this group's subtree.
                  if (e.target !== e.currentTarget) return;
                  e.dataTransfer.setData("text/plain", g.id);
                  e.dataTransfer.setData("type", "group");
                  e.dataTransfer.effectAllowed = "move";
                  dnd.startDrag("group", g.id, g.parentGroupId);
                }}
                onDragEnd={() => dnd.cancel()}
                onDragOver={(e) => {
                  if (dnd.drag?.type === "project") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    dnd.dragOver("group", g.id, e.clientY, {
                      top: rect.top,
                      height: rect.height,
                    });
                    return;
                  }
                  if (dnd.drag?.type !== "group") return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  dnd.dragOver(
                    "group",
                    g.id,
                    e.clientY,
                    { top: rect.top, height: rect.height },
                    { targetParentId: g.parentGroupId },
                  );
                }}
                onDragLeave={() => dnd.dragLeave()}
                onDrop={(e) => {
                  if (dnd.drag?.type === "project") {
                    e.preventDefault();
                    e.stopPropagation();
                    const snap = dnd.drop("group", g.id);
                    if (!snap) return;
                    handleProjectDropOnGroup(snap, g);
                    return;
                  }
                  if (dnd.drag?.type !== "group") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const snap = dnd.drop("group", g.id);
                  if (!snap) return;
                  handleGroupDropOnGroup(snap, g);
                }}
              >
                <GroupRow
                  group={g}
                  depth={depth}
                  parentGroupId={g.parentGroupId}
                  onTouchStart={(e) =>
                    touch.handleTouchStart(e, "group", g.id, g.parentGroupId)
                  }
                  onTouchMove={touch.handleTouchMove}
                  onTouchEnd={touch.handleTouchEnd}
                  dropIndicator={indicatorFor("group", g.id)}
                  isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
                  isEditing={editingNode?.id === g.id && editingNode?.type === "group"}
                  sessionCount={recursiveSessionCount(activeSessions, tree.groups, tree.projects, g.id)}
                  rolledStats={rolledUpRepoStats(
                    tree.groups,
                    tree.projects,
                    props.getProjectRepoStats,
                    { type: "group", id: g.id, collapsed: g.collapsed }
                  )}
                  hasCustomPrefs={false}
                  onSelect={() => void tree.setActiveNode({ id: g.id, type: "group" })}
                  onToggleCollapse={() => void tree.updateGroup({ id: g.id, collapsed: !g.collapsed })}
                  onOpenPreferences={
                    props.onOpenPreferences
                      ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                      : undefined
                  }
                  onStartEdit={() => setEditingNode({ id: g.id, type: "group" })}
                  onSaveEdit={async (name) => {
                    await tree.updateGroup({ id: g.id, name });
                    setEditingNode(null);
                  }}
                  onCancelEdit={() => setEditingNode(null)}
                  onCreateSubgroup={() => setCreating({ parentGroupId: g.id, kind: "group" })}
                  onCreateProject={() => setCreating({ parentGroupId: g.id, kind: "project" })}
                >
                  {renderGroupSubtree(g.id, depth + 1)}
                </GroupRow>
              </div>
            </GroupContextMenu>
          </TreeConnector>
        ))}
        {creating?.parentGroupId === groupId && creating.kind === "group" && (
          <CreateNodeInline
            depth={depth}
            kind="group"
            onSubmit={async (name) => {
              await tree.createGroup({ name, parentGroupId: groupId });
              setCreating(null);
            }}
            onCancel={() => setCreating(null)}
          />
        )}
        {childProjects.map((p, i) => (
          <TreeConnector key={p.id} depth={depth} isLastChild={i === childProjects.length - 1 && creating?.parentGroupId !== groupId}>
            <ProjectContextMenu
              project={p}
              hasCustomPrefs={hasCustomPrefs(p)}
              hasActiveSecrets={hasActiveSecrets(p)}
              hasLinkedRepo={hasLinkedRepo(p)}
              hasWorkingDirectory={hasWorkingDirectory(p)}
              onNewTerminal={() => props.onProjectNewSession(p.id)}
              onNewAgent={() => props.onProjectNewAgent(p.id)}
              onResume={() => props.onProjectResumeClaudeSession(p.id)}
              onAdvanced={() => props.onProjectAdvancedSession(p.id)}
              onNewWorktree={() => props.onProjectNewWorktree(p.id)}
              onOpenPreferences={
                props.onOpenPreferences
                  ? () => props.onOpenPreferences!({ id: p.id, type: "project", name: p.name })
                  : () => {}
              }
              onOpenSecrets={() => props.onProjectOpenSecrets(p.id)}
              onOpenRepository={() => props.onProjectOpenRepository(p.id, p.name)}
              onOpenFolderInOS={() => props.onProjectOpenFolderInOS(p.id)}
              onViewIssues={
                props.onProjectViewIssues
                  ? () => props.onProjectViewIssues!(p.id)
                  : undefined
              }
              onViewPRs={
                props.onProjectViewPRs
                  ? () => props.onProjectViewPRs!(p.id)
                  : undefined
              }
              onStartEdit={() => setEditingNode({ id: p.id, type: "project" })}
              onDelete={() => handleDeleteProject(p)}
            >
              <div
                draggable
                onDragStart={(e) => {
                  // Drag might have originated from a descendant SessionRow —
                  // let the bubble reach us, but don't overwrite session drag
                  // state with a project drag.
                  if (e.target !== e.currentTarget) return;
                  e.dataTransfer.setData("text/plain", p.id);
                  e.dataTransfer.setData("type", "project");
                  e.dataTransfer.effectAllowed = "move";
                  dnd.startDrag("project", p.id, p.groupId);
                }}
                onDragEnd={() => dnd.cancel()}
                onDragOver={(e) => {
                  if (dnd.drag?.type === "session") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    dnd.dragOver("project", p.id, e.clientY, {
                      top: rect.top,
                      height: rect.height,
                    });
                    return;
                  }
                  if (dnd.drag?.type !== "project") return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  dnd.dragOver(
                    "project",
                    p.id,
                    e.clientY,
                    { top: rect.top, height: rect.height },
                    { targetParentId: p.groupId },
                  );
                }}
                onDragLeave={() => dnd.dragLeave()}
                onDrop={(e) => {
                  if (dnd.drag?.type === "session") {
                    e.preventDefault();
                    e.stopPropagation();
                    const snap = dnd.drop("project", p.id);
                    if (!snap) return;
                    handleSessionDropOnProject(snap, p);
                    return;
                  }
                  if (dnd.drag?.type !== "project") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const snap = dnd.drop("project", p.id);
                  if (!snap) return;
                  handleProjectDropOnProject(snap, p);
                }}
              >
                <ProjectRow
                  project={p}
                  depth={depth}
                  parentGroupId={p.groupId}
                  onTouchStart={(e) =>
                    touch.handleTouchStart(e, "project", p.id, p.groupId)
                  }
                  onTouchMove={touch.handleTouchMove}
                  onTouchEnd={touch.handleTouchEnd}
                  dropIndicator={indicatorFor("project", p.id)}
                  isActive={tree.activeNode?.id === p.id && tree.activeNode?.type === "project"}
                  isEditing={editingNode?.id === p.id && editingNode?.type === "project"}
                  collapsed={p.collapsed}
                  sessionCount={sessionsForProject(activeSessions, p.id, { excludeFileSessions: true }).length}
                  ownStats={props.getProjectRepoStats(p.id)}
                  hasCustomPrefs={false}
                  hasActiveSecrets={hasActiveSecrets(p)}
                  hasLinkedRepo={hasLinkedRepo(p)}
                  onSelect={() => void tree.setActiveNode({ id: p.id, type: "project" })}
                  onToggleCollapse={() =>
                    void tree.updateProject({ id: p.id, collapsed: !p.collapsed })
                  }
                  onOpenPreferences={
                    props.onOpenPreferences
                      ? () => props.onOpenPreferences!({ id: p.id, type: "project", name: p.name })
                      : undefined
                  }
                  onStartEdit={() => setEditingNode({ id: p.id, type: "project" })}
                  onSaveEdit={async (name) => {
                    await tree.updateProject({ id: p.id, name });
                    setEditingNode(null);
                  }}
                  onCancelEdit={() => setEditingNode(null)}
                >
                  {!p.collapsed && renderSessions(p.id, depth + 1)}
                </ProjectRow>
              </div>
            </ProjectContextMenu>
          </TreeConnector>
        ))}
        {creating?.parentGroupId === groupId && creating.kind === "project" && (
          <CreateNodeInline
            depth={depth}
            kind="project"
            onSubmit={async (name) => {
              await tree.createProject({ name, groupId });
              setCreating(null);
            }}
            onCancel={() => setCreating(null)}
          />
        )}
      </>
    );
  };

  return (
    <div
      className="flex flex-col gap-0.5 px-1 py-2"
      onDragOver={(e) => {
        if (dnd.drag?.type !== "group") return;
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (dnd.drag?.type !== "group") return;
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        const draggedId = dnd.drag.id;
        // Clear drag state (drop() without a matching indicator returns null
        // but still clears — we use cancel() here for clarity since the
        // indicator may not be set on whitespace drops).
        dnd.cancel();
        const current = tree.groups.find((g) => g.id === draggedId);
        if (!current || current.parentGroupId === null) return;
        void tree.moveGroup({ id: draggedId, newParentGroupId: null });
      }}
    >
      {rootEntries.groups.map((g, i) => (
        <TreeConnector
          key={g.id}
          depth={0}
          isLastChild={i === rootEntries.groups.length - 1}
        >
          <GroupContextMenu
            group={g}
            hasCustomPrefs={hasNodePreferences("group", g.id)}
            onCreateProject={() => setCreating({ parentGroupId: g.id, kind: "project" })}
            onCreateSubgroup={() => setCreating({ parentGroupId: g.id, kind: "group" })}
            onOpenPreferences={
              props.onOpenPreferences
                ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                : () => {}
            }
            onStartEdit={() => setEditingNode({ id: g.id, type: "group" })}
            onMoveToRoot={() => void tree.moveGroup({ id: g.id, newParentGroupId: null })}
            onDelete={() => handleDeleteGroup(g)}
          >
            <div
              draggable
              onDragStart={(e) => {
                // Only register this as a group drag if the dragstart originated
                // on the wrapper itself, not bubbled up from a nested ProjectRow
                // or SessionRow inside this group's subtree.
                if (e.target !== e.currentTarget) return;
                e.dataTransfer.setData("text/plain", g.id);
                e.dataTransfer.setData("type", "group");
                e.dataTransfer.effectAllowed = "move";
                dnd.startDrag("group", g.id, g.parentGroupId);
              }}
              onDragEnd={() => dnd.cancel()}
              onDragOver={(e) => {
                if (dnd.drag?.type === "project") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  dnd.dragOver("group", g.id, e.clientY, {
                    top: rect.top,
                    height: rect.height,
                  });
                  return;
                }
                if (dnd.drag?.type !== "group") return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                dnd.dragOver(
                  "group",
                  g.id,
                  e.clientY,
                  { top: rect.top, height: rect.height },
                  { targetParentId: g.parentGroupId },
                );
              }}
              onDragLeave={() => dnd.dragLeave()}
              onDrop={(e) => {
                if (dnd.drag?.type === "project") {
                  e.preventDefault();
                  e.stopPropagation();
                  const snap = dnd.drop("group", g.id);
                  if (!snap) return;
                  handleProjectDropOnGroup(snap, g);
                  return;
                }
                if (dnd.drag?.type !== "group") return;
                e.preventDefault();
                e.stopPropagation();
                const snap = dnd.drop("group", g.id);
                if (!snap) return;
                handleGroupDropOnGroup(snap, g);
              }}
            >
              <GroupRow
                group={g}
                depth={0}
                parentGroupId={g.parentGroupId}
                onTouchStart={(e) =>
                  touch.handleTouchStart(e, "group", g.id, g.parentGroupId)
                }
                onTouchMove={touch.handleTouchMove}
                onTouchEnd={touch.handleTouchEnd}
                dropIndicator={indicatorFor("group", g.id)}
                isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
                isEditing={editingNode?.id === g.id && editingNode?.type === "group"}
                sessionCount={recursiveSessionCount(activeSessions, tree.groups, tree.projects, g.id)}
                rolledStats={rolledUpRepoStats(
                  tree.groups,
                  tree.projects,
                  props.getProjectRepoStats,
                  { type: "group", id: g.id, collapsed: g.collapsed }
                )}
                hasCustomPrefs={false}
                onSelect={() => void tree.setActiveNode({ id: g.id, type: "group" })}
                onToggleCollapse={() => void tree.updateGroup({ id: g.id, collapsed: !g.collapsed })}
                onOpenPreferences={
                  props.onOpenPreferences
                    ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                    : undefined
                }
                onStartEdit={() => setEditingNode({ id: g.id, type: "group" })}
                onSaveEdit={async (name) => {
                  await tree.updateGroup({ id: g.id, name });
                  setEditingNode(null);
                }}
                onCancelEdit={() => setEditingNode(null)}
                onCreateSubgroup={() => setCreating({ parentGroupId: g.id, kind: "group" })}
                onCreateProject={() => setCreating({ parentGroupId: g.id, kind: "project" })}
              >
                {renderGroupSubtree(g.id, 1)}
              </GroupRow>
            </div>
          </GroupContextMenu>
        </TreeConnector>
      ))}
      {creating?.parentGroupId === null && creating.kind === "group" && (
        <CreateNodeInline
          depth={0}
          kind="group"
          onSubmit={async (name) => {
            await tree.createGroup({ name, parentGroupId: null });
            setCreating(null);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}
