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
  // Project handlers (take legacyFolderId)
  onProjectNewSession: (legacyFolderId: string) => void;
  onProjectNewAgent: (legacyFolderId: string) => void;
  onProjectResumeClaudeSession: (legacyFolderId: string) => void;
  onProjectAdvancedSession: (legacyFolderId: string) => void;
  onProjectNewWorktree: (legacyFolderId: string) => void;
  onProjectOpenSecrets: (legacyFolderId: string) => void;
  onProjectOpenRepository: (legacyFolderId: string, name: string) => void;
  onProjectOpenFolderInOS: (legacyFolderId: string) => void;
  onProjectViewIssues?: (legacyFolderId: string) => void;
  onProjectViewPRs?: (legacyFolderId: string) => void;
  // Session handlers
  onSessionTogglePin: (sessionId: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onSessionSchedule?: (sessionId: string) => void;
  // Predicates (folder-keyed)
  folderHasPreferences: (folderId: string) => boolean;
}

export function ProjectTreeSidebar(props: Props) {
  const tree = useProjectTree();
  const [editingNode, setEditingNode] = useState<{ id: string; type: "group" | "project" | "session" } | null>(null);
  const [creating, setCreating] = useState<{ parentGroupId: string | null; kind: "group" | "project" } | null>(null);
  const { sessions, activeSessionId, getAgentActivityStatus } = useSessionContext();
  const { getFolderPreferences } = usePreferencesContext();
  const { folderConfigs } = useSecretsContext();
  const { notifications } = useNotificationContext();

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== "closed"),
    [sessions]
  );

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

  // Helper: get legacyFolderId for a project node
  const fid = (p: ProjectNode): string | null => p.legacyFolderId ?? null;

  // Predicates (folder-keyed via legacyFolderId shim)
  const hasCustomPrefs = (p: ProjectNode): boolean =>
    fid(p) != null && props.folderHasPreferences(fid(p)!);

  const hasLinkedRepo = (p: ProjectNode): boolean =>
    fid(p) != null && getFolderPreferences(fid(p)!)?.githubRepoId != null;

  const hasActiveSecrets = (p: ProjectNode): boolean =>
    fid(p) != null && (folderConfigs.get(fid(p)!)?.enabled ?? false);

  const hasWorkingDirectory = (p: ProjectNode): boolean =>
    fid(p) != null && getFolderPreferences(fid(p)!)?.defaultWorkingDirectory != null;

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
            // onSessionMove takes a folderId, not projectId — resolve via legacyFolderId
            const proj = targetProjectId
              ? tree.projects.find((p) => p.id === targetProjectId)
              : null;
            const folderId = proj?.legacyFolderId ?? null;
            props.onSessionMove(s.id, folderId);
          }}
          onSchedule={props.onSessionSchedule ? () => props.onSessionSchedule!(s.id) : undefined}
          onClose={() => props.onSessionClose(s.id)}
        >
          <div>
            <SessionRow
              session={s}
              depth={depth}
              isActive={s.id === activeSessionId}
              isEditing={editingNode?.id === s.id && editingNode?.type === "session"}
              hasUnread={(sessionUnread.get(s.id) ?? 0) > 0}
              agentStatus={s.terminalType === "agent" ? getAgentActivityStatus(s.id) : null}
              scheduleCount={0}
              onClick={() => props.onSessionClick(s.id)}
              onClose={() => props.onSessionClose(s.id)}
              onStartEdit={() => {
                props.onSessionStartEdit(s.id);
                setEditingNode({ id: s.id, type: "session" });
              }}
              onSaveEdit={(name) => {
                props.onSessionRename(s.id, name);
                setEditingNode(null);
              }}
              onCancelEdit={() => setEditingNode(null)}
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
              hasCustomPrefs={props.folderHasPreferences(g.id)}
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
              <div>
                <GroupRow
                  group={g}
                  depth={depth}
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
              legacyFolderAvailable={fid(p) != null}
              onNewTerminal={() => { const f = fid(p); if (f) props.onProjectNewSession(f); }}
              onNewAgent={() => { const f = fid(p); if (f) props.onProjectNewAgent(f); }}
              onResume={() => { const f = fid(p); if (f) props.onProjectResumeClaudeSession(f); }}
              onAdvanced={() => { const f = fid(p); if (f) props.onProjectAdvancedSession(f); }}
              onNewWorktree={() => { const f = fid(p); if (f) props.onProjectNewWorktree(f); }}
              onOpenPreferences={
                props.onOpenPreferences
                  ? () => props.onOpenPreferences!({ id: p.id, type: "project", name: p.name })
                  : () => {}
              }
              onOpenSecrets={() => { const f = fid(p); if (f) props.onProjectOpenSecrets(f); }}
              onOpenRepository={() => { const f = fid(p); if (f) props.onProjectOpenRepository(f, p.name); }}
              onOpenFolderInOS={() => { const f = fid(p); if (f) props.onProjectOpenFolderInOS(f); }}
              onViewIssues={
                props.onProjectViewIssues && fid(p)
                  ? () => props.onProjectViewIssues!(fid(p)!)
                  : undefined
              }
              onViewPRs={
                props.onProjectViewPRs && fid(p)
                  ? () => props.onProjectViewPRs!(fid(p)!)
                  : undefined
              }
              onStartEdit={() => setEditingNode({ id: p.id, type: "project" })}
              onDelete={() => handleDeleteProject(p)}
            >
              <div>
                <ProjectRow
                  project={p}
                  depth={depth}
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
    <div className="flex flex-col gap-0.5 px-1 py-2">
      {rootEntries.groups.map((g, i) => (
        <TreeConnector
          key={g.id}
          depth={0}
          isLastChild={i === rootEntries.groups.length - 1}
        >
          <GroupContextMenu
            group={g}
            hasCustomPrefs={props.folderHasPreferences(g.id)}
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
            <div>
              <GroupRow
                group={g}
                depth={0}
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
