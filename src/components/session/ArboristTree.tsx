"use client";

import { useRef, useCallback, useMemo } from "react";
import { Tree, TreeApi, NodeRendererProps, NodeApi } from "react-arborist";
import {
  Terminal, Folder, FolderOpen, Pencil, Trash2, Sparkles, GitBranch,
  GitPullRequest, CircleDot, KeyRound, Brain, RefreshCw, BookOpen, Bot, Settings,
  Lightbulb, Clock, X,
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
        return <Brain className="w-3 h-3 text-purple-400 shrink-0" />;
      }
      if (session.agentProvider && session.agentProvider !== "none") {
        return <Bot className="w-3 h-3 text-blue-400 shrink-0" />;
      }
      return <Terminal className="w-3 h-3 text-muted-foreground shrink-0" />;
    }

    if (isTrashNode(data)) {
      return <Trash2 className="w-3 h-3 text-destructive/70 shrink-0" />;
    }

    // Folder
    return node.isOpen
      ? <FolderOpen className="w-3 h-3 text-primary/70 shrink-0" />
      : <Folder className="w-3 h-3 text-primary/70 shrink-0" />;
  };

  // Render badges (for folders with stats, sessions with schedules)
  // All badges are rendered in a single container div that flows left after the text
  const renderBadges = () => {
    // Collect badge elements
    const badges: React.ReactNode[] = [];

    // Session badges - show schedule count if available
    if (isSessionNode(data)) {
      if (handlers.getSchedulesForSession) {
        const schedules = handlers.getSchedulesForSession(data.session.id);
        const activeCount = schedules.filter(s => s.enabled).length;
        if (activeCount > 0) {
          badges.push(
            <button
              key="schedule"
              onClick={(e) => {
                e.stopPropagation();
                handlers.onSessionSchedulesView?.(data.session.id, data.session.name);
              }}
              className="inline-flex items-center gap-0.5 text-primary hover:text-primary/80 transition-colors"
            >
              <Clock className="w-2 h-2" />
              {activeCount}
            </button>
          );
        }
      }
    }

    // Trash count badge
    if (isTrashNode(data)) {
      badges.push(
        <span key="trash" className="text-muted-foreground/50 tabular-nums">
          {data.trashCount}
        </span>
      );
    }

    // Folder badges
    if (isFolderNode(data)) {
      const { stats, sessionCount } = data;

      // Issue count
      if (stats && stats.issueCount > 0) {
        badges.push(
          <span key="issues" className="inline-flex items-center text-chart-2">
            <CircleDot className="w-2 h-2" />
            <span className="ml-0.5">{stats.issueCount}</span>
          </span>
        );
      }

      // Changes indicator
      if (stats?.hasChanges) {
        badges.push(
          <span key="changes" className="w-1 h-1 rounded-full bg-primary animate-pulse" />
        );
      }

      // Session count
      if (sessionCount > 0) {
        badges.push(
          <span key="sessions" className="text-muted-foreground/50 tabular-nums">
            {sessionCount}
          </span>
        );
      }
    }

    // Return null if no badges
    if (badges.length === 0) {
      return null;
    }

    // Render all badges in a single container
    return (
      <div className="flex items-center gap-1 shrink-0 text-[9px] leading-none">
        {badges}
      </div>
    );
  };

  // Handle click
  const handleClick = () => {
    if (isSessionNode(data)) {
      handlers.onSessionClick(data.session.id);
    } else if (isFolderNode(data)) {
      // Toggle expand/collapse on click
      node.toggle();
      handlers.onFolderClick(data.folder.id);
    } else if (isTrashNode(data)) {
      // Toggle trash folder on click
      node.toggle();
    }
  };

  // Handle double click - for sessions, this can be used for a rename action
  const handleDoubleClick = () => {
    if (isFolderNode(data) || isTrashNode(data)) {
      // Double click on folder toggles expand/collapse
      node.toggle();
    }
    // Sessions: double click currently does nothing extra
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
            "group flex items-center gap-1.5 px-2 py-0.5 cursor-pointer select-none",
            "hover:bg-accent/50 transition-colors duration-150 rounded-sm",
            "max-w-full overflow-hidden box-border",
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
              className="flex-1 min-w-0 bg-transparent border border-primary/50 rounded px-1 py-0 text-[11px] outline-none"
            />
          ) : (
            <span className={cn(
              "flex-1 min-w-0 truncate text-[11px]",
              isTrashNode(data) && "text-muted-foreground italic"
            )}>
              {node.data.name}
            </span>
          )}

          {renderBadges()}

          {/* Close button - only for sessions, visible on hover */}
          {isSessionNode(data) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlers.onSessionClose(data.session.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/20 rounded transition-opacity"
              title="Close session"
            >
              <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
            </button>
          )}
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
    const { dragIds, parentId, index } = args;

    // Get the target folder ID
    const targetFolderId = parentId?.startsWith("folder-")
      ? parentId.replace("folder-", "")
      : null;

    // Get current children in target location
    const siblingFolders = folders
      .filter(f => f.parentId === targetFolderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const siblingSessions = sessions
      .filter(s => s.folderId === targetFolderId && s.status !== "closed" && s.status !== "trashed")
      .sort((a, b) => a.tabOrder - b.tabOrder);

    dragIds.forEach(dragId => {
      if (dragId.startsWith("session-")) {
        const sessionId = dragId.replace("session-", "");
        const session = sessions.find(s => s.id === sessionId);

        if (!session) return;

        // Check if this is a move to a different folder or just reordering
        const isChangingFolder = session.folderId !== targetFolderId;

        if (isChangingFolder) {
          // Moving to different folder - use the move handler
          props.onSessionMove(sessionId, targetFolderId);
        }

        // Handle reordering within the folder
        // Build new order of session IDs based on drop index
        const otherSessionIds = siblingSessions
          .filter(s => s.id !== sessionId)
          .map(s => s.id);

        // Insert the dragged session at the new index
        // Account for folders being rendered before sessions in the tree
        const adjustedIndex = Math.max(0, index - siblingFolders.length);
        const newSessionOrder = [
          ...otherSessionIds.slice(0, adjustedIndex),
          sessionId,
          ...otherSessionIds.slice(adjustedIndex),
        ];

        // Call reorder handler if we have sessions to reorder
        if (newSessionOrder.length > 0) {
          props.onSessionReorder(newSessionOrder);
        }
      } else if (dragId.startsWith("folder-")) {
        const folderId = dragId.replace("folder-", "");
        const folder = folders.find(f => f.id === folderId);

        if (!folder) return;

        // Check if this is a move to a different parent or just reordering
        const isChangingParent = folder.parentId !== targetFolderId;

        if (isChangingParent) {
          // Moving to different parent - use the move handler
          props.onFolderMove(folderId, targetFolderId);
        }

        // Handle reordering within the parent
        // Build new order of folder IDs based on drop index
        const otherFolderIds = siblingFolders
          .filter(f => f.id !== folderId)
          .map(f => f.id);

        // Insert the dragged folder at the new index
        const newFolderOrder = [
          ...otherFolderIds.slice(0, index),
          folderId,
          ...otherFolderIds.slice(index),
        ];

        // Call reorder handler if we have folders to reorder
        if (newFolderOrder.length > 0) {
          props.onFolderReorder(newFolderOrder);
        }
      }
    });
  }, [props, folders, sessions]);

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

  // Account for padding when calculating available width
  // Subtract 16px for container padding and scrollbar space to prevent overflow
  const treeWidth = Math.max(width - 16, 100);

  return (
    <div className="overflow-hidden pr-2">
      <Tree<TreeNode>
        ref={treeRef}
        data={treeData}
        openByDefault={false}
        initialOpenState={initialOpenState}
        onToggle={handleToggle}
        width={treeWidth}
        height={height}
        indent={14}
        rowHeight={24}
        overscanCount={5}

        // Drag and drop
        onMove={handleMove}
        disableDrop={disableDrop}
        disableDrag={disableDrag}

        // Custom rendering with tree connector lines
        renderRow={({ node, innerRef, attrs, children }) => {
          const depth = node.level;
          // Calculate connector line position: depth * indent + offset for icon centering
          const connectorLeft = depth > 0 ? (depth * 14) + 7 : 0;

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
    </div>
  );
}
