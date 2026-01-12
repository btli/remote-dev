"use client";

import { useRef, useCallback, useMemo } from "react";
import { Tree, TreeApi, NodeRendererProps, NodeApi } from "react-arborist";
import {
  Terminal, Folder, FolderOpen, Pencil, Trash2, Sparkles, GitBranch,
  GitPullRequest, CircleDot, KeyRound, Brain, RefreshCw, BookOpen, Bot, Settings,
  Lightbulb, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { SessionSchedule } from "@/types/schedule";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ============================================================================
// Types
// ============================================================================

export interface SessionFolder {
  id: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
}

export interface FolderRepoStats {
  prCount: number;
  issueCount: number;
  hasChanges: boolean;
}

/**
 * Base tree node structure for react-arborist
 * Custom data is included directly in the node object
 */
export type TreeNodeType = "folder" | "session" | "trash";

export interface BaseTreeNode {
  id: string;
  name: string;
  children?: TreeNode[];
}

export interface FolderTreeNode extends BaseTreeNode {
  nodeType: "folder";
  folder: SessionFolder;
  stats: FolderRepoStats | null;
  sessionCount: number;
  hasPreferences: boolean;
  hasRepo: boolean;
  hasSecrets: boolean;
  children: TreeNode[];
}

export interface TrashTreeNode extends BaseTreeNode {
  nodeType: "trash";
  parentFolderId: string;
  trashCount: number;
}

export interface SessionTreeNode extends BaseTreeNode {
  nodeType: "session";
  session: TerminalSession;
}

export type TreeNode = FolderTreeNode | SessionTreeNode | TrashTreeNode;

/**
 * Props for the ArboristTree component
 */
export interface ArboristTreeProps {
  sessions: TerminalSession[];
  folders: SessionFolder[];
  activeSessionId: string | null;
  activeFolderId: string | null;

  // Data accessors
  folderHasPreferences: (folderId: string) => boolean;
  folderHasRepo: (folderId: string) => boolean;
  getFolderRepoStats: (folderId: string) => FolderRepoStats | null;
  getFolderTrashCount: (folderId: string) => number;
  folderHasSecrets: (folderId: string) => boolean;

  // Session handlers
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string, options?: { deleteWorktree?: boolean }) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;

  // Folder handlers
  onFolderCreate: (name: string, parentId?: string | null) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderClick: (folderId: string) => void;
  onFolderSettings: (folderId: string, folderName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => void;
  onFolderNewSession: (folderId: string, type: "agent" | "terminal") => void;
  onFolderAdvancedSession: (folderId: string) => void;
  onFolderNewWorktree: (folderId: string) => void;
  onFolderMove: (folderId: string, newParentId: string | null) => void;
  onFolderReorder: (folderIds: string[]) => void;
  onEmptyTrash: (folderId: string) => void;

  // Optional handlers
  onViewIssues?: (folderId: string) => void;
  onViewPRs?: (folderId: string) => void;
  onFolderReinitOrchestrator?: (folderId: string) => void;
  onOrchestratorReinstallHooks?: (folderId: string) => void;
  onFolderKnowledge?: (folderId: string, folderName: string) => void;
  onFolderSecretsConfig?: (folderId: string) => void;
  onSessionSchedule?: (sessionId: string) => void;
  onSessionSchedulesView?: (sessionId: string, sessionName: string) => void;
  onSessionOptimize?: (sessionId: string) => void;
  getSchedulesForSession?: (sessionId: string) => SessionSchedule[];

  // Dimensions
  height: number;
  width: number;
}

// ============================================================================
// Tree Data Transformation
// ============================================================================

/**
 * Transform folders and sessions into react-arborist tree structure
 */
function buildTreeData(
  folders: SessionFolder[],
  sessions: TerminalSession[],
  folderHasPreferences: (id: string) => boolean,
  folderHasRepo: (id: string) => boolean,
  getFolderRepoStats: (id: string) => FolderRepoStats | null,
  getFolderTrashCount: (id: string) => number,
  folderHasSecrets: (id: string) => boolean,
): TreeNode[] {
  // Filter active sessions
  const activeSessions = sessions.filter(s => s.status !== "closed" && s.status !== "trashed");

  // Group sessions by folder
  const sessionsByFolder = new Map<string | null, TerminalSession[]>();
  activeSessions.forEach(session => {
    const folderId = session.folderId;
    if (!sessionsByFolder.has(folderId)) {
      sessionsByFolder.set(folderId, []);
    }
    sessionsByFolder.get(folderId)!.push(session);
  });

  // Sort sessions within each folder by tabOrder
  sessionsByFolder.forEach(folderSessions => {
    folderSessions.sort((a, b) => a.tabOrder - b.tabOrder);
  });

  // Count sessions recursively for a folder
  const countSessionsRecursively = (folderId: string): number => {
    const directSessions = sessionsByFolder.get(folderId)?.length ?? 0;
    const childFolders = folders.filter(f => f.parentId === folderId);
    const childSessions = childFolders.reduce((sum, child) => sum + countSessionsRecursively(child.id), 0);
    return directSessions + childSessions;
  };

  // Build folder node with its children (subfolders + sessions)
  const buildFolderNode = (folder: SessionFolder): FolderTreeNode => {
    const children: TreeNode[] = [];

    // Add subfolders first (sorted by sortOrder)
    const subfolders = folders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    subfolders.forEach(subfolder => {
      children.push(buildFolderNode(subfolder));
    });

    // Add sessions (sorted by tabOrder)
    const folderSessions = sessionsByFolder.get(folder.id) ?? [];
    folderSessions.forEach(session => {
      children.push({
        id: `session-${session.id}`,
        name: session.name,
        nodeType: "session",
        session,
      } as SessionTreeNode);
    });

    // Add trash folder if there are trashed items
    const trashCount = getFolderTrashCount(folder.id);
    if (trashCount > 0) {
      children.push({
        id: `trash-${folder.id}`,
        name: ".trash",
        nodeType: "trash",
        parentFolderId: folder.id,
        trashCount,
      } as TrashTreeNode);
    }

    return {
      id: `folder-${folder.id}`,
      name: folder.name,
      nodeType: "folder",
      folder,
      stats: getFolderRepoStats(folder.id),
      sessionCount: countSessionsRecursively(folder.id),
      hasPreferences: folderHasPreferences(folder.id),
      hasRepo: folderHasRepo(folder.id),
      hasSecrets: folderHasSecrets(folder.id),
      children,
    };
  };

  // Build root level nodes
  const rootNodes: TreeNode[] = [];

  // Add root folders (sorted by sortOrder)
  const rootFolders = folders
    .filter(f => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  rootFolders.forEach(folder => {
    rootNodes.push(buildFolderNode(folder));
  });

  // Add root-level sessions (no folder)
  const rootSessions = sessionsByFolder.get(null) ?? [];
  rootSessions.forEach(session => {
    rootNodes.push({
      id: `session-${session.id}`,
      name: session.name,
      nodeType: "session",
      session,
    } as SessionTreeNode);
  });

  return rootNodes;
}

// ============================================================================
// Type Guards
// ============================================================================

function isFolderNode(node: TreeNode): node is FolderTreeNode {
  return node.nodeType === "folder";
}

function isSessionNode(node: TreeNode): node is SessionTreeNode {
  return node.nodeType === "session";
}

function isTrashNode(node: TreeNode): node is TrashTreeNode {
  return node.nodeType === "trash";
}

// ============================================================================
// Node Renderer
// ============================================================================

interface TreeNodeRendererProps extends NodeRendererProps<TreeNode> {
  // Context menu handlers passed from parent
  handlers: ArboristTreeProps;
  allFolders: SessionFolder[];
}

function TreeNodeRenderer({ node, style, dragHandle, handlers, allFolders }: TreeNodeRendererProps) {
  const data = node.data;

  // Determine if this node is selected
  const isSelected = isSessionNode(data)
    ? handlers.activeSessionId === data.session.id
    : isFolderNode(data)
      ? handlers.activeFolderId === data.folder.id
      : false;

  // Determine icon based on node type
  const renderIcon = () => {
    if (isSessionNode(data)) {
      const session = data.session;
      if (session.isOrchestratorSession) {
        return <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      }
      if (session.agentProvider && session.agentProvider !== "none") {
        return <Bot className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      }
      return <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
    }

    if (isTrashNode(data)) {
      return <Trash2 className="w-3.5 h-3.5 text-destructive/70 shrink-0" />;
    }

    // Folder
    return node.isOpen
      ? <FolderOpen className="w-3.5 h-3.5 text-primary/70 shrink-0" />
      : <Folder className="w-3.5 h-3.5 text-primary/70 shrink-0" />;
  };

  // Render badges (for folders with stats, sessions with schedules)
  const renderBadges = () => {
    // Session badges - show schedule count if available
    if (isSessionNode(data)) {
      if (!handlers.getSchedulesForSession) return null;
      const schedules = handlers.getSchedulesForSession(data.session.id);
      const activeCount = schedules.filter(s => s.enabled).length;
      if (activeCount === 0) return null;
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlers.onSessionSchedulesView?.(data.session.id, data.session.name);
          }}
          className="flex items-center gap-0.5 text-[9px] text-primary shrink-0 hover:text-primary/80 transition-colors ml-auto"
        >
          <Clock className="w-2.5 h-2.5" />
          {activeCount}
        </button>
      );
    }

    // Show trash count for trash nodes
    if (isTrashNode(data)) {
      return (
        <span className="text-[10px] text-muted-foreground/50 ml-auto">
          {data.trashCount}
        </span>
      );
    }

    // Folder badges
    if (!isFolderNode(data)) {
      return null;
    }

    const { stats, sessionCount, hasSecrets } = data;

    return (
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* PR count */}
        {stats && stats.prCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-primary">
            <GitPullRequest className="w-2.5 h-2.5" />
            {stats.prCount}
          </span>
        )}

        {/* Issue count */}
        {stats && stats.issueCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-chart-2">
            <CircleDot className="w-2.5 h-2.5" />
            {stats.issueCount}
          </span>
        )}

        {/* Changes indicator */}
        {stats?.hasChanges && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}

        {/* Secrets indicator */}
        {hasSecrets && (
          <KeyRound className="w-2.5 h-2.5 text-primary/50" />
        )}

        {/* Session count */}
        {sessionCount > 0 && (
          <span className="text-[10px] text-muted-foreground/50 min-w-[1.5ch] text-right">
            {sessionCount}
          </span>
        )}
      </div>
    );
  };

  // Handle click
  const handleClick = () => {
    if (isSessionNode(data)) {
      handlers.onSessionClick(data.session.id);
    } else if (isFolderNode(data)) {
      handlers.onFolderClick(data.folder.id);
    }
    // Trash nodes don't have a click action
  };

  // Handle double click for folders (toggle expand)
  const handleDoubleClick = () => {
    if (isFolderNode(data) || isTrashNode(data)) {
      node.toggle();
    }
  };

  // Context menu content based on node type
  const renderContextMenuContent = () => {
    if (isSessionNode(data)) {
      const session = data.session;
      return (
        <>
          <ContextMenuItem onClick={() => node.edit()}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Rename
          </ContextMenuItem>

          {/* Move to folder submenu */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Folder className="w-3.5 h-3.5 mr-2" />
              Move to Folder
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem
                onClick={() => handlers.onSessionMove(session.id, null)}
                disabled={session.folderId === null}
              >
                <FolderOpen className="w-3.5 h-3.5 mr-2" />
                Root (No Folder)
              </ContextMenuItem>
              <ContextMenuSeparator />
              {allFolders.map(folder => (
                <ContextMenuItem
                  key={folder.id}
                  onClick={() => handlers.onSessionMove(session.id, folder.id)}
                  disabled={session.folderId === folder.id}
                >
                  <Folder className="w-3.5 h-3.5 mr-2" />
                  {folder.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          {handlers.onSessionSchedule && (
            <ContextMenuItem onClick={() => handlers.onSessionSchedule!(session.id)}>
              <Clock className="w-3.5 h-3.5 mr-2" />
              Schedule Command
            </ContextMenuItem>
          )}

          {handlers.onSessionSchedulesView && handlers.getSchedulesForSession && (
            (() => {
              const schedules = handlers.getSchedulesForSession(session.id);
              if (schedules.length === 0) return null;
              return (
                <ContextMenuItem onClick={() => handlers.onSessionSchedulesView!(session.id, session.name)}>
                  <Clock className="w-3.5 h-3.5 mr-2" />
                  View Schedules ({schedules.length})
                </ContextMenuItem>
              );
            })()
          )}

          {handlers.onSessionOptimize && session.agentProvider && session.agentProvider !== "none" && (
            <ContextMenuItem onClick={() => handlers.onSessionOptimize!(session.id)}>
              <Lightbulb className="w-3.5 h-3.5 mr-2" />
              Optimize Agent
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          <ContextMenuItem
            onClick={() => handlers.onSessionClose(session.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Close Session
          </ContextMenuItem>
        </>
      );
    }

    if (isTrashNode(data)) {
      return (
        <ContextMenuItem onClick={() => handlers.onEmptyTrash(data.parentFolderId)}>
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          Empty Trash
        </ContextMenuItem>
      );
    }

    // Folder context menu
    const folder = data.folder;

    return (
      <>
        <ContextMenuItem onClick={() => handlers.onFolderNewSession(folder.id, "agent")}>
          <Bot className="w-3.5 h-3.5 mr-2" />
          New Agent
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.onFolderNewSession(folder.id, "terminal")}>
          <Terminal className="w-3.5 h-3.5 mr-2" />
          New Terminal
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handlers.onFolderAdvancedSession(folder.id)}>
          <Sparkles className="w-3.5 h-3.5 mr-2" />
          Advanced...
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => handlers.onFolderNewWorktree(folder.id)}
          disabled={!data.hasRepo}
          className={!data.hasRepo ? "opacity-50" : ""}
        >
          <GitBranch className="w-3.5 h-3.5 mr-2" />
          New Worktree
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handlers.onFolderCreate("New Folder", folder.id)}>
          <Folder className="w-3.5 h-3.5 mr-2" />
          New Subfolder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handlers.onFolderSettings(folder.id, folder.name)}>
          <Settings className="w-3.5 h-3.5 mr-2" />
          Preferences
          {data.hasPreferences && (
            <span className="ml-auto text-[10px] text-primary">Custom</span>
          )}
        </ContextMenuItem>
        {handlers.onFolderSecretsConfig && (
          <ContextMenuItem onClick={() => handlers.onFolderSecretsConfig!(folder.id)}>
            <KeyRound className="w-3.5 h-3.5 mr-2" />
            Secrets
            {data.hasSecrets && (
              <span className="ml-auto text-[10px] text-primary">Active</span>
            )}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => handlers.onFolderSettings(folder.id, folder.name, "repository")}>
          <GitBranch className="w-3.5 h-3.5 mr-2" />
          Repository
          {data.hasRepo && (
            <span className="ml-auto text-[10px] text-primary">Linked</span>
          )}
        </ContextMenuItem>

        {handlers.onFolderKnowledge && (
          <ContextMenuItem onClick={() => handlers.onFolderKnowledge!(folder.id, folder.name)}>
            <BookOpen className="w-3.5 h-3.5 mr-2" />
            View Knowledge
          </ContextMenuItem>
        )}

        {handlers.onViewIssues && data.hasRepo && (
          <ContextMenuItem onClick={() => handlers.onViewIssues!(folder.id)}>
            <CircleDot className="w-3.5 h-3.5 mr-2" />
            View Issues
          </ContextMenuItem>
        )}

        {handlers.onViewPRs && data.hasRepo && (
          <ContextMenuItem onClick={() => handlers.onViewPRs!(folder.id)}>
            <GitPullRequest className="w-3.5 h-3.5 mr-2" />
            View PRs
          </ContextMenuItem>
        )}

        {(handlers.onFolderReinitOrchestrator || handlers.onOrchestratorReinstallHooks) && (
          <>
            <ContextMenuSeparator />
            {handlers.onFolderReinitOrchestrator && (
              <ContextMenuItem onClick={() => handlers.onFolderReinitOrchestrator!(folder.id)}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />
                Reinitialize Orchestrator
              </ContextMenuItem>
            )}
            {handlers.onOrchestratorReinstallHooks && (
              <ContextMenuItem onClick={() => handlers.onOrchestratorReinstallHooks!(folder.id)}>
                <Settings className="w-3.5 h-3.5 mr-2" />
                Reinstall Hooks
              </ContextMenuItem>
            )}
          </>
        )}

        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => node.edit()}>
          <Pencil className="w-3.5 h-3.5 mr-2" />
          Rename
        </ContextMenuItem>
        {folder.parentId && (
          <ContextMenuItem onClick={() => handlers.onFolderMove(folder.id, null)}>
            <FolderOpen className="w-3.5 h-3.5 mr-2" />
            Move to Root
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => handlers.onFolderDelete(folder.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          Delete
        </ContextMenuItem>
      </>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragHandle}
          style={style}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none",
            "hover:bg-accent/50 transition-colors duration-150 rounded-sm",
            isSelected && "bg-primary/20",
            node.state.isEditing && "bg-accent",
            node.isDragging && "opacity-50",
          )}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {renderIcon()}

          {node.isEditing ? (
            <input
              type="text"
              defaultValue={node.data.name}
              onBlur={() => node.reset()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const newName = e.currentTarget.value.trim();
                  if (newName && newName !== node.data.name) {
                    if (isSessionNode(data)) {
                      handlers.onSessionRename(data.session.id, newName);
                    } else if (isFolderNode(data)) {
                      handlers.onFolderRename(data.folder.id, newName);
                    }
                  }
                  node.reset();
                } else if (e.key === "Escape") {
                  node.reset();
                }
              }}
              autoFocus
              className="flex-1 bg-transparent border border-primary/50 rounded px-1 py-0.5 text-sm outline-none"
            />
          ) : (
            <span className={cn(
              "flex-1 truncate text-sm",
              isTrashNode(data) && "text-muted-foreground italic"
            )}>
              {node.data.name}
            </span>
          )}

          {renderBadges()}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {renderContextMenuContent()}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ArboristTree(props: ArboristTreeProps) {
  const treeRef = useRef<TreeApi<TreeNode>>(null);

  const {
    sessions,
    folders,
    folderHasPreferences,
    folderHasRepo,
    getFolderRepoStats,
    getFolderTrashCount,
    folderHasSecrets,
    height,
    width,
  } = props;

  // Memoize tree data transformation
  const treeData = useMemo(() =>
    buildTreeData(
      folders,
      sessions,
      folderHasPreferences,
      folderHasRepo,
      getFolderRepoStats,
      getFolderTrashCount,
      folderHasSecrets,
    ),
    [folders, sessions, folderHasPreferences, folderHasRepo, getFolderRepoStats, getFolderTrashCount, folderHasSecrets]
  );

  // Compute initial open state from folder collapsed state
  // In folders: collapsed=true means closed, collapsed=false means open
  // In react-arborist: OpenMap stores { id: isOpen }
  const initialOpenState = useMemo(() => {
    const openMap: Record<string, boolean> = {};
    folders.forEach(folder => {
      // folder.collapsed=false means it should be open
      openMap[`folder-${folder.id}`] = !folder.collapsed;
    });
    return openMap;
  }, [folders]);

  // Handle toggle events to sync with folder state
  const handleToggle = useCallback((nodeId: string) => {
    if (nodeId.startsWith("folder-")) {
      const folderId = nodeId.replace("folder-", "");
      props.onFolderToggle(folderId);
    }
    // Trash folders toggle locally without persisting
  }, [props]);

  // Handle drag and drop move
  const handleMove = useCallback((args: {
    dragIds: string[];
    parentId: string | null;
    index: number;
  }) => {
    const { dragIds, parentId } = args;
    // Note: index is available for reordering but not yet implemented

    dragIds.forEach(dragId => {
      if (dragId.startsWith("session-")) {
        const sessionId = dragId.replace("session-", "");
        const targetFolderId = parentId?.startsWith("folder-")
          ? parentId.replace("folder-", "")
          : null;

        props.onSessionMove(sessionId, targetFolderId);

        // TODO: Handle reordering based on index
        // This would require updating the session's tabOrder
      } else if (dragId.startsWith("folder-")) {
        const folderId = dragId.replace("folder-", "");
        const targetParentId = parentId?.startsWith("folder-")
          ? parentId.replace("folder-", "")
          : null;

        props.onFolderMove(folderId, targetParentId);

        // TODO: Handle reordering based on index
      }
    });
  }, [props]);

  // Determine if a node can be dropped on another
  const disableDrop = useCallback((args: {
    parentNode: NodeApi<TreeNode>;
    dragNodes: NodeApi<TreeNode>[];
    index: number;
  }) => {
    const { dragNodes, parentNode } = args;

    // Don't allow dropping sessions on other sessions
    if (parentNode && isSessionNode(parentNode.data)) {
      return true;
    }

    // Don't allow dropping on trash folders
    if (parentNode && isTrashNode(parentNode.data)) {
      return true;
    }

    // Don't allow dropping folders into their own descendants
    for (const dragNode of dragNodes) {
      if (isFolderNode(dragNode.data)) {
        let current: NodeApi<TreeNode> | null = parentNode;
        while (current) {
          if (current.id === dragNode.id) {
            return true;
          }
          current = current.parent;
        }
      }
    }

    return false;
  }, []);

  // Determine if a node can be dragged
  // Note: disableDrag receives the data (TreeNode), not the NodeApi
  const disableDrag = useCallback((data: TreeNode) => {
    // Don't allow dragging trash folders
    return isTrashNode(data);
  }, []);

  // Custom node renderer wrapper
  const renderNode = useCallback((nodeProps: NodeRendererProps<TreeNode>) => (
    <TreeNodeRenderer {...nodeProps} handlers={props} allFolders={folders} />
  ), [props, folders]);

  return (
    <Tree<TreeNode>
      ref={treeRef}
      data={treeData}
      openByDefault={false}
      initialOpenState={initialOpenState}
      onToggle={handleToggle}
      width={width}
      height={height}
      indent={12}
      rowHeight={28}
      overscanCount={5}

      // Drag and drop
      onMove={handleMove}
      disableDrop={disableDrop}
      disableDrag={disableDrag}

      // Custom rendering with tree connector lines
      renderRow={({ node, innerRef, attrs, children }) => {
        const depth = node.level;
        // Calculate connector line position: depth * indent + offset
        const connectorLeft = depth > 0 ? (depth * 12) + 7 : 0;

        return (
          <div
            ref={innerRef}
            {...attrs}
            className="relative tree-item"
            style={{
              ...attrs.style,
              "--tree-connector-left": depth > 0 ? `${connectorLeft}px` : undefined,
            } as React.CSSProperties}
          >
            {children}
          </div>
        );
      }}
    >
      {renderNode}
    </Tree>
  );
}
