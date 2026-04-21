"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X, Plus, Terminal, Settings,
  Folder, FolderOpen, Pencil, Trash2, Sparkles, GitBranch, MessageCircle,
  PanelLeftClose, PanelLeft, ExternalLink,
  GitPullRequest, CircleDot, Clock, KeyRound, Fingerprint, Network,
  Pin, PinOff, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import type { TerminalSession } from "@/types/session";
import type { PinnedFile } from "@/types/pinned-files";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { SecretsConfigModal } from "@/components/secrets/SecretsConfigModal";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useProfileContext } from "@/contexts/ProfileContext";
import { usePortContext } from "@/contexts/PortContext";
import { useSessionMCP, useSessionMCPAutoLoad } from "@/contexts/SessionMCPContext";
import { MCPServersSection } from "@/components/mcp";
import { FilesSection } from "./FilesSection";
import { ProjectTreeSidebar } from "./ProjectTreeSidebar";
import { SessionMetadataBar } from "./SessionMetadataBar";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { SessionProgressBar } from "./SessionProgressBar";
import { useSessionContext } from "@/contexts/SessionContext";
import { useNotificationContext } from "@/contexts/NotificationContext";

export interface SessionFolder {
  id: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
}

interface FolderNode extends SessionFolder {
  children: FolderNode[];
  depth: number;
}

// Initial state for touch drag ref (reused in resets to prevent drift)
const INITIAL_TOUCH_DRAG = { type: null, id: null, startX: 0, startY: 0, element: null, clone: null, isDragging: false } as const;

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;
const COLLAPSED_SIDEBAR_WIDTH = 48;

// Folder repo stats returned by getFolderRepoStats
export interface FolderRepoStats {
  prCount: number;
  issueCount: number;
  hasChanges: boolean;
}

interface SidebarProps {
  sessions: TerminalSession[];
  folders: SessionFolder[];
  activeSessionId: string | null;
  activeFolderId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  folderHasPreferences: (folderId: string) => boolean;
  folderHasRepo: (folderId: string) => boolean;
  getFolderRepoStats: (folderId: string) => FolderRepoStats | null;
  getFolderTrashCount: (folderId: string) => number;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string, options?: { deleteWorktree?: boolean }) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionTogglePin: (sessionId: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onNewAgent: () => void;
  onFolderCreate: (name: string, parentId?: string | null) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderClick: (folderId: string) => void;
  onFolderSettings: (folderId: string, folderName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => void;
  onFolderNewSession: (folderId: string) => void;
  onFolderNewAgent: (folderId: string) => void;
  onFolderResumeClaudeSession: (folderId: string) => void;
  onFolderAdvancedSession: (folderId: string) => void;
  onFolderNewWorktree: (folderId: string) => void;
  onFolderMove: (folderId: string, newParentId: string | null) => void;
  onFolderReorder: (folderIds: string[]) => void;
  onFolderEmpty: (folderId: string) => void;
  onEmptyTrash: (folderId: string) => void;
  trashCount: number;
  onTrashOpen: () => void;
  onSessionSchedule?: (sessionId: string) => void;
  onProfilesOpen?: () => void;
  onPortsOpen?: () => void;
  onViewIssues?: (folderId: string) => void;
  onViewPRs?: (folderId: string) => void;
  getFolderPinnedFiles?: (folderId: string) => PinnedFile[];
  onOpenPinnedFile?: (folderId: string, file: PinnedFile) => void;
  /**
   * Phase 4: invoked when the user clicks the settings gear on a ProjectTree
   * row (group or project). Opens the corresponding
   * Group/ProjectPreferencesModal. When omitted, gear icons are hidden.
   */
  onOpenNodePreferences?: (node: {
    id: string;
    type: "group" | "project";
    name: string;
  }) => void;
}

/**
 * Whether a session type has agent-like behavior (activity status tracking, exit states).
 */
function hasAgentBehavior(session: TerminalSession): boolean {
  return session.terminalType === "agent" || session.terminalType === "loop";
}

/**
 * Resolve sidebar icon color class for a session based on agent activity status.
 * Agent sessions get color-coded by their real-time activity; non-agent sessions
 * use simple active/inactive styling.
 */
function getSessionIconColor(
  session: TerminalSession,
  isActive: boolean,
  getAgentActivityStatus: (sessionId: string) => string
): string {
  if (!hasAgentBehavior(session)) {
    return isActive ? "text-primary" : "text-muted-foreground";
  }

  const status = getAgentActivityStatus(session.id);
  switch (status) {
    case "running":
      return "text-green-500 agent-breathing";
    case "waiting":
      return "text-yellow-500 agent-breathing";
    case "compacting":
      return "text-blue-500 agent-breathing";
    case "idle":
    case "ended":
      return "text-muted-foreground";
    case "error":
      return "text-red-500";
    default:
      return isActive ? "text-primary" : "text-muted-foreground";
  }
}

export function Sidebar({
  sessions,
  folders,
  activeSessionId,
  activeFolderId,
  collapsed,
  onCollapsedChange,
  width = DEFAULT_SIDEBAR_WIDTH,
  onWidthChange,
  folderHasPreferences,
  folderHasRepo,
  getFolderRepoStats,
  getFolderTrashCount,
  onSessionClick,
  onSessionClose,
  onSessionRename,
  onSessionTogglePin,
  onSessionMove,
  onSessionReorder,
  onNewSession,
  onQuickNewSession,
  onNewAgent,
  onFolderCreate,
  onFolderRename,
  onFolderDelete,
  onFolderToggle,
  onFolderClick,
  onFolderSettings,
  onFolderNewSession,
  onFolderNewAgent,
  onFolderResumeClaudeSession,
  onFolderAdvancedSession,
  onFolderNewWorktree,
  onFolderMove,
  onFolderReorder,
  onFolderEmpty,
  onEmptyTrash,
  trashCount,
  onTrashOpen,
  onSessionSchedule,
  onProfilesOpen,
  onPortsOpen,
  onViewIssues,
  onViewPRs,
  getFolderPinnedFiles,
  onOpenPinnedFile,
  onOpenNodePreferences,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<"session" | "folder" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingSubfolderId, setCreatingSubfolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);
  // Folder reorder state
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [dropFolderPosition, setDropFolderPosition] = useState<"before" | "after" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  // Secrets modal state
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);
  const [secretsModalFolderId, setSecretsModalFolderId] = useState<string | null>(null);
  const { folderConfigs } = useSecretsContext();
  const { getFolderPreferences } = usePreferencesContext();
  const { profileCount } = useProfileContext();
  const { allocations, activePorts } = usePortContext();
  const { getAgentActivityStatus } = useSessionContext();
  const { notifications } = useNotificationContext();

  // Compute per-session unread notification counts
  const sessionUnreadMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notifications) {
      if (n.sessionId && !n.readAt) {
        map[n.sessionId] = (map[n.sessionId] ?? 0) + 1;
      }
    }
    return map;
  }, [notifications]);

  // Mobile detection and swipe-to-close state
  const isMobile = useMobile();
  const [swipedSessionId, setSwipedSessionId] = useState<string | null>(null);
  const swipeTouchRef = useRef<{
    startX: number;
    startY: number;
    sessionId: string | null;
    el: HTMLElement | null;
    isHorizontal: boolean | null;
  }>({ startX: 0, startY: 0, sessionId: null, el: null, isHorizontal: null });

  // Reset swipe state when swiped session is removed or sidebar collapses
  const [prevCollapsed, setPrevCollapsed] = useState(collapsed);
  if (swipedSessionId && !sessions.some(s => s.id === swipedSessionId)) {
    setSwipedSessionId(null);
  }
  if (collapsed !== prevCollapsed) {
    setPrevCollapsed(collapsed);
    if (collapsed && swipedSessionId) {
      setSwipedSessionId(null);
    }
  }
  // DOM cleanup after swipe is cleared (effect may access refs safely)
  useEffect(() => {
    if (!swipedSessionId) {
      const ref = swipeTouchRef.current;
      if (ref.el) {
        ref.el.style.transform = "";
        ref.el.style.transition = "";
      }
      swipeTouchRef.current = { startX: 0, startY: 0, sessionId: null, el: null, isHorizontal: null };
    }
  }, [swipedSessionId]);

  // Touch drag state for touch-capable devices (folder reordering; disabled on mobile phones where context menu is used instead)
  const touchDragRef = useRef<{
    type: "folder" | "session" | null;
    id: string | null;
    startX: number;
    startY: number;
    element: HTMLElement | null;
    clone: HTMLElement | null;
    isDragging: boolean; // True once long-press delay completes
  }>({ ...INITIAL_TOUCH_DRAG });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_DELAY = 400; // ms before drag initiates
  const LONG_PRESS_MOVE_THRESHOLD = 10; // px movement to cancel long-press

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartXRef.current;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidthRef.current + delta)
      );
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onWidthChange]);

  // Cleanup longPressTimer and drag clones on unmount to prevent memory leaks / visual glitches
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      // Remove any orphaned drag clone
      const drag = touchDragRef.current;
      if (drag.clone) {
        drag.clone.remove();
      }
      if (drag.element) {
        drag.element.style.opacity = "";
      }
      touchDragRef.current = { ...INITIAL_TOUCH_DRAG };
    };
  }, []);

  // Schedule context for showing schedule indicators on session rows
  const { getSchedulesForSession } = useScheduleContext();

  // Find active session and check if it's an agent session
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isAgentSession = activeSession?.terminalType === "agent";

  // MCP context for showing MCP servers when agent session is selected
  useSessionMCPAutoLoad(activeSessionId, isAgentSession);
  const { mcpSupported } = useSessionMCP();

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Handler for session close - worktree sessions are automatically trashed by SessionManager
  const handleSessionCloseRequest = useCallback((session: TerminalSession) => {
    // Close directly - SessionManager handles trashing worktree sessions automatically
    onSessionClose(session.id);
  }, [onSessionClose]);

  // Sessions not in any folder - use session.projectId directly for accurate rendering
  const rootSessions = activeSessions.filter(
    (s) => !s.projectId
  );
  const pinnedRootSessions = rootSessions.filter((s) => s.pinned);
  const unpinnedRootSessions = rootSessions.filter((s) => !s.pinned);

  // Build folder tree from flat list, sorted by sortOrder
  // Memoized to prevent recalculation on every render
  const folderTree = useMemo(() => {
    const folderMap = new Map<string, FolderNode>();
    const rootFolders: FolderNode[] = [];

    // First pass: create nodes
    folders.forEach((folder) => {
      folderMap.set(folder.id, { ...folder, children: [], depth: 0 });
    });

    // Second pass: build tree
    folders.forEach((folder) => {
      const node = folderMap.get(folder.id)!;
      if (folder.parentId && folderMap.has(folder.parentId)) {
        const parent = folderMap.get(folder.parentId)!;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        rootFolders.push(node);
      }
    });

    // Third pass: recalculate depths and sort children by sortOrder
    const setDepthsAndSort = (nodes: FolderNode[], depth: number) => {
      nodes.sort((a, b) => a.sortOrder - b.sortOrder);
      nodes.forEach((node) => {
        node.depth = depth;
        setDepthsAndSort(node.children, depth + 1);
      });
    };
    setDepthsAndSort(rootFolders, 0);

    return rootFolders;
  }, [folders]);

  // Check if a folder is a descendant of another
  const isDescendantOf = useCallback((folderId: string, ancestorId: string): boolean => {
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    let current = folderMap.get(folderId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = folderMap.get(current.parentId);
    }
    return false;
  }, [folders]);

  // Calculate rolled-up stats for a folder
  // When a folder is collapsed, aggregate stats from all descendants
  // When expanded, show only its own stats (children show theirs)
  const getRolledUpStats = useCallback((folderId: string): FolderRepoStats | null => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return null;

    // If folder is expanded, show only its own stats
    if (!folder.collapsed) {
      return getFolderRepoStats(folderId);
    }

    // Folder is collapsed - aggregate stats from self and all descendants
    const sumDescendantStats = (nodeId: string): { prCount: number; issueCount: number; hasChanges: boolean } => {
      let prCount = 0;
      let issueCount = 0;
      let hasChanges = false;

      // Get this folder's own stats
      const ownStats = getFolderRepoStats(nodeId);
      if (ownStats) {
        prCount += ownStats.prCount;
        issueCount += ownStats.issueCount;
        hasChanges = hasChanges || ownStats.hasChanges;
      }

      // Find children and recursively add their stats
      const children = folders.filter(f => f.parentId === nodeId);
      for (const child of children) {
        const childStats = sumDescendantStats(child.id);
        prCount += childStats.prCount;
        issueCount += childStats.issueCount;
        hasChanges = hasChanges || childStats.hasChanges;
      }

      return { prCount, issueCount, hasChanges };
    };

    const stats = sumDescendantStats(folderId);
    if (stats.prCount === 0 && stats.issueCount === 0 && !stats.hasChanges) {
      return null;
    }
    return stats;
  }, [folders, getFolderRepoStats]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (creatingFolder && folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [creatingFolder]);

  const handleStartEdit = (id: string, type: "session" | "folder", currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingType(type);
    setEditValue(currentName);
  };

  const handleSaveEdit = () => {
    if (editingId && editValue.trim()) {
      if (editingType === "session") {
        onSessionRename(editingId, editValue.trim());
      } else if (editingType === "folder") {
        onFolderRename(editingId, editValue.trim());
      }
    }
    setEditingId(null);
    setEditingType(null);
    setEditValue("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingType(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onFolderCreate(newFolderName.trim(), creatingSubfolderId);
      setNewFolderName("");
      setCreatingFolder(false);
      setCreatingSubfolderId(null);
    }
  };

  const handleOpenFolder = useCallback(async (folderId: string) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/open`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        console.error("Failed to open folder:", data?.error || res.statusText);
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, []);

  const handleStartSubfolderCreate = (parentId: string) => {
    setCreatingSubfolderId(parentId);
    setCreatingFolder(true);
    setNewFolderName("");
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCreateFolder();
    } else if (e.key === "Escape") {
      setCreatingFolder(false);
      setCreatingSubfolderId(null);
      setNewFolderName("");
    }
  };

  // Drag and drop handlers for sessions
  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.setData("type", "session");
    e.dataTransfer.effectAllowed = "move";
    setDraggedSessionId(sessionId);
    (e.target as HTMLElement).classList.add("opacity-50");
  };

  // Drag and drop handlers for folders
  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    e.dataTransfer.setData("text/plain", folderId);
    e.dataTransfer.setData("type", "folder");
    e.dataTransfer.effectAllowed = "move";
    setDraggingFolderId(folderId);
    (e.target as HTMLElement).classList.add("opacity-50");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove("opacity-50");
    setDragOverFolderId(null);
    setDraggingFolderId(null);
    setDraggedSessionId(null);
    setDropTargetId(null);
    setDropPosition(null);
    setDropTargetFolderId(null);
    setDropFolderPosition(null);
  };

  // Touch handlers for drag-and-drop with long-press delay (disabled on mobile phones to avoid conflict with context menu)
  const initiateTouchDrag = useCallback((element: HTMLElement, clientX: number, clientY: number) => {
    // Create a visual clone for dragging feedback
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.top = `${clientY - 20}px`;
    clone.style.left = `${element.getBoundingClientRect().left}px`;
    clone.style.width = `${element.offsetWidth}px`;
    clone.style.opacity = "0.8";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "1000";
    clone.style.backgroundColor = "hsl(var(--primary) / 0.3)";
    clone.style.borderRadius = "6px";
    document.body.appendChild(clone);

    touchDragRef.current.clone = clone;
    touchDragRef.current.isDragging = true;
    element.style.opacity = "0.5";

    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }

    setDraggingFolderId(touchDragRef.current.id);
  }, []);

  const handleFolderTouchStart = useCallback((e: React.TouchEvent, folderId: string) => {
    const touch = e.touches[0];
    const element = e.currentTarget as HTMLElement;

    // Store initial state for long-press detection
    touchDragRef.current = {
      type: "folder",
      id: folderId,
      startX: touch.clientX,
      startY: touch.clientY,
      element,
      clone: null,
      isDragging: false,
    };

    // Start long-press timer
    longPressTimerRef.current = setTimeout(() => {
      initiateTouchDrag(element, touch.clientX, touch.clientY);
    }, LONG_PRESS_DELAY);
  }, [initiateTouchDrag]);

  const handleFolderTouchMove = useCallback((e: React.TouchEvent) => {
    const drag = touchDragRef.current;
    if (!drag.id) return;

    const touch = e.touches[0];

    // If not yet dragging, check if movement exceeds threshold to cancel long-press
    if (!drag.isDragging) {
      const deltaX = Math.abs(touch.clientX - drag.startX);
      const deltaY = Math.abs(touch.clientY - drag.startY);
      if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
        // User is scrolling, cancel the long-press timer
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        // Reset touch state
        touchDragRef.current = { ...INITIAL_TOUCH_DRAG };
      }
      return;
    }

    // Dragging is active - move the clone
    if (!drag.clone) return;
    drag.clone.style.top = `${touch.clientY - 20}px`;

    // Find folder element under touch point
    drag.clone.style.display = "none";
    const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
    drag.clone.style.display = "";

    // Find the closest folder item
    const folderElement = elementUnder?.closest("[data-folder-id]") as HTMLElement | null;

    if (folderElement && folderElement.dataset.folderId !== drag.id) {
      const targetFolderId = folderElement.dataset.folderId!;
      const targetParentId = folderElement.dataset.folderParentId || null;
      const rect = folderElement.getBoundingClientRect();
      const relativeY = touch.clientY - rect.top;
      const threshold = rect.height * 0.25;

      const draggedFolder = folders.find((f) => f.id === drag.id);
      const draggedParentId = draggedFolder?.parentId ?? null;
      const areSiblings = draggedParentId === targetParentId;

      if (areSiblings && relativeY < threshold) {
        setDropTargetFolderId(targetFolderId);
        setDropFolderPosition("before");
        setDragOverFolderId(null);
      } else if (areSiblings && relativeY > rect.height - threshold) {
        setDropTargetFolderId(targetFolderId);
        setDropFolderPosition("after");
        setDragOverFolderId(null);
      } else {
        setDragOverFolderId(targetFolderId);
        setDropTargetFolderId(null);
        setDropFolderPosition(null);
      }
    } else {
      setDragOverFolderId(null);
      setDropTargetFolderId(null);
      setDropFolderPosition(null);
    }
  }, [folders]);

  const handleFolderTouchEnd = useCallback(() => {
    // Cancel long-press timer if still running
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    const drag = touchDragRef.current;

    // Clean up clone
    if (drag.clone) {
      drag.clone.remove();
    }
    if (drag.element) {
      drag.element.style.opacity = "";
    }

    // Only perform drop if drag was actually initiated (long-press completed)
    if (drag.id && drag.isDragging) {
      if (dropFolderPosition && dropTargetFolderId) {
        // Reorder mode
        const draggedFolder = folders.find((f) => f.id === drag.id);
        const draggedParentId = draggedFolder?.parentId ?? null;
        const siblings = folders.filter((f) => (f.parentId ?? null) === draggedParentId);
        const currentOrder = siblings.sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.id);
        const newOrder = currentOrder.filter((id) => id !== drag.id);
        const targetIndex = newOrder.indexOf(dropTargetFolderId);
        const insertIndex = dropFolderPosition === "before" ? targetIndex : targetIndex + 1;
        newOrder.splice(insertIndex, 0, drag.id);
        onFolderReorder(newOrder);
      } else if (dragOverFolderId && !isDescendantOf(dragOverFolderId, drag.id)) {
        // Nest mode
        onFolderMove(drag.id, dragOverFolderId);
      }
    }

    // Reset state
    touchDragRef.current = { ...INITIAL_TOUCH_DRAG };
    setDraggingFolderId(null);
    setDragOverFolderId(null);
    setDropTargetFolderId(null);
    setDropFolderPosition(null);
  }, [folders, dropFolderPosition, dropTargetFolderId, dragOverFolderId, onFolderReorder, onFolderMove, isDescendantOf]);

  const handleDragOver = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't allow dropping on self or descendants
    if (draggingFolderId && folderId) {
      if (draggingFolderId === folderId || isDescendantOf(folderId, draggingFolderId)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
    }

    e.dataTransfer.dropEffect = "move";
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
    // Clear reorder indicators when over folder (not session)
    setDropTargetId(null);
    setDropPosition(null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null);
      setDropTargetId(null);
      setDropPosition(null);
      setDropTargetFolderId(null);
      setDropFolderPosition(null);
    }
  };

  // Handler for dragging a folder over another folder (for reordering or nesting)
  const handleFolderDragOver = (e: React.DragEvent, targetFolderId: string, targetParentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    // If dragging a session, delegate to session-to-folder logic
    if (draggedSessionId) {
      e.dataTransfer.dropEffect = "move";
      if (dragOverFolderId !== targetFolderId) {
        setDragOverFolderId(targetFolderId);
      }
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    // Only handle folder-to-folder operations
    if (!draggingFolderId || draggingFolderId === targetFolderId) {
      setDropTargetFolderId(null);
      setDropFolderPosition(null);
      return;
    }

    // Don't allow dropping on self or descendants
    if (isDescendantOf(targetFolderId, draggingFolderId)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }

    e.dataTransfer.dropEffect = "move";

    // Use position-based detection:
    // - Top 25% / Bottom 25%: reorder (before/after) - only for siblings
    // - Middle 50%: move into folder (nest)
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const threshold = rect.height * 0.25;

    const draggedFolder = folders.find((f) => f.id === draggingFolderId);
    const draggedParentId = draggedFolder?.parentId ?? null;
    const areSiblings = draggedParentId === targetParentId;

    if (areSiblings && relativeY < threshold) {
      // Top edge - reorder before (only for siblings)
      setDropTargetFolderId(targetFolderId);
      setDropFolderPosition("before");
      setDragOverFolderId(null);
    } else if (areSiblings && relativeY > rect.height - threshold) {
      // Bottom edge - reorder after (only for siblings)
      setDropTargetFolderId(targetFolderId);
      setDropFolderPosition("after");
      setDragOverFolderId(null);
    } else {
      // Center - move into folder (nest)
      setDragOverFolderId(targetFolderId);
      setDropTargetFolderId(null);
      setDropFolderPosition(null);
    }
  };

  // Handler for dropping a folder on another folder (for reordering or moving)
  const handleFolderDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // If dropping a session onto a folder, delegate to handleDrop
    const dragType = e.dataTransfer.getData("type");
    const dragId = e.dataTransfer.getData("text/plain");
    if (dragType === "session" || (!draggingFolderId && dragId)) {
      onSessionMove(dragId, targetFolderId);
      setDragOverFolderId(null);
      setDropTargetId(null);
      setDropPosition(null);
      setDraggedSessionId(null);
      return;
    }

    if (!draggingFolderId || draggingFolderId === targetFolderId) {
      setDragOverFolderId(null);
      setDraggingFolderId(null);
      setDropTargetFolderId(null);
      setDropFolderPosition(null);
      return;
    }

    // Check current drop mode based on state set by handleFolderDragOver
    if (dropFolderPosition && dropTargetFolderId === targetFolderId) {
      // Reorder mode - reorder siblings
      const draggedFolder = folders.find((f) => f.id === draggingFolderId);
      const draggedParentId = draggedFolder?.parentId ?? null;

      const siblings = folders.filter((f) => (f.parentId ?? null) === draggedParentId);
      const currentOrder = siblings.sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.id);

      // Remove dragged item from current position
      const newOrder = currentOrder.filter((id) => id !== draggingFolderId);

      // Find target position
      const targetIndex = newOrder.indexOf(targetFolderId);
      const insertIndex = dropFolderPosition === "before" ? targetIndex : targetIndex + 1;

      // Insert at new position
      newOrder.splice(insertIndex, 0, draggingFolderId);

      onFolderReorder(newOrder);
    } else if (dragOverFolderId === targetFolderId) {
      // Nest mode - move folder into target
      if (!isDescendantOf(targetFolderId, draggingFolderId)) {
        onFolderMove(draggingFolderId, targetFolderId);
      }
    }

    setDragOverFolderId(null);
    setDraggingFolderId(null);
    setDropTargetFolderId(null);
    setDropFolderPosition(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    const type = e.dataTransfer.getData("type");

    if (type === "folder" && id) {
      // Moving a folder
      if (id !== folderId && !isDescendantOf(folderId || "", id)) {
        onFolderMove(id, folderId);
      }
    } else if (id) {
      // Moving a session
      onSessionMove(id, folderId);
    }

    setDragOverFolderId(null);
    setDraggingFolderId(null);
    setDropTargetId(null);
    setDropPosition(null);
    setDraggedSessionId(null);
  };

  // Handler for dropping on a session (for reordering)
  const handleSessionDrop = (e: React.DragEvent, targetSessionId: string, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData("text/plain");
    const dragType = e.dataTransfer.getData("type");

    // Only handle session drops for reordering
    if (!draggedId || draggedId === targetSessionId || dragType === "folder") {
      setDragOverFolderId(null);
      setDropTargetId(null);
      setDropPosition(null);
      setDraggedSessionId(null);
      return;
    }

    // Check if in the same folder - use session.projectId directly
    const draggedSession = activeSessions.find((s) => s.id === draggedId);
    const draggedFolderId = draggedSession?.projectId || null;
    if (draggedFolderId !== targetFolderId) {
      // Different folder - move to target folder
      onSessionMove(draggedId, targetFolderId);
    } else {
      // Same folder - reorder within same pin partition
      const draggedPinned = draggedSession?.pinned ?? false;
      const sessionsInFolder = activeSessions.filter(
        (s) => (s.projectId || null) === targetFolderId && s.pinned === draggedPinned
      );
      const currentOrder = sessionsInFolder.map((s) => s.id);

      // Remove dragged item from current position
      const newOrder = currentOrder.filter((id) => id !== draggedId);

      // Find target position
      const targetIndex = newOrder.indexOf(targetSessionId);
      const insertIndex = dropPosition === "before" ? targetIndex : targetIndex + 1;

      // Insert at new position
      newOrder.splice(insertIndex, 0, draggedId);

      // Get full session order (include sessions from other folders)
      const fullOrder: string[] = [];

      // Add sessions from each folder
      // For the target folder, include reordered partition first, then the other partition
      const otherPartitionIds = activeSessions
        .filter((s) => (s.projectId || null) === targetFolderId && s.pinned !== draggedPinned)
        .map((s) => s.id);
      folders.forEach((folder) => {
        if (folder.id === targetFolderId) {
          // Pinned sessions first, then unpinned (consistent with render order)
          if (draggedPinned) {
            fullOrder.push(...newOrder, ...otherPartitionIds);
          } else {
            fullOrder.push(...otherPartitionIds, ...newOrder);
          }
        } else {
          // Keep existing order for other folders
          const otherFolderSessions = activeSessions
            .filter((s) => s.projectId === folder.id)
            .map((s) => s.id);
          fullOrder.push(...otherFolderSessions);
        }
      });

      // Add root sessions
      if (targetFolderId === null) {
        // Reordering root sessions - include both partitions
        const otherRootPartitionIds = activeSessions
          .filter((s) => !s.projectId && s.pinned !== draggedPinned)
          .map((s) => s.id);
        if (draggedPinned) {
          fullOrder.push(...newOrder, ...otherRootPartitionIds);
        } else {
          fullOrder.push(...otherRootPartitionIds, ...newOrder);
        }
      } else {
        // Keep existing order for root sessions
        const rootSessionIds = activeSessions
          .filter((s) => !s.projectId)
          .map((s) => s.id);
        fullOrder.push(...rootSessionIds);
      }

      onSessionReorder(fullOrder);
    }

    setDragOverFolderId(null);
    setDropTargetId(null);
    setDropPosition(null);
    setDraggedSessionId(null);
  };

  // Handler for dragging over a session (for reordering)
  const handleSessionDragOver = (e: React.DragEvent, targetSessionId: string, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    // Don't show indicator for the dragged item itself
    if (targetSessionId === draggedSessionId) {
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    // Check if dragged session is in the same folder - use session.projectId directly
    const draggedSession = draggedSessionId ? activeSessions.find((s) => s.id === draggedSessionId) : null;
    const targetSession = activeSessions.find((s) => s.id === targetSessionId);
    const draggedFolderId = draggedSession?.projectId || null;
    if (draggedFolderId !== targetFolderId) {
      // Different folder - treat as folder drop
      setDragOverFolderId(targetFolderId);
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    // Don't allow reordering across pin partitions
    if (draggedSession && targetSession && draggedSession.pinned !== targetSession.pinned) {
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    // Same folder and pin state - show reorder indicator
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? "before" : "after";

    setDropTargetId(targetSessionId);
    setDropPosition(position);
    setDragOverFolderId(null);
  };

  // renderSession accepts depth for indentation, parentFolderId for drag-drop targeting, and inSplit for split styling
  const renderSession = (session: TerminalSession, depth = 0, parentFolderId: string | null = null, inSplit = false) => {
    const isActive = session.id === activeSessionId;
    const isEditing = editingId === session.id;
    const inFolder = parentFolderId !== null;
    const currentFolderId = session.projectId; // Used in context menu - use session.projectId directly
    const isDragOverSession = parentFolderId !== null && dragOverFolderId === parentFolderId;
    const isDropTarget = dropTargetId === session.id;
    const showDropBefore = isDropTarget && dropPosition === "before";
    const showDropAfter = isDropTarget && dropPosition === "after";

    // Collapsed view — session icon with tooltip for name
    if (collapsed) {
      const iconColor = getSessionIconColor(session, isActive, getAgentActivityStatus);
      const statusText = hasAgentBehavior(session) ? getAgentActivityStatus(session.id) : null;
      const showStatus = statusText && statusText !== "idle";
      return (
        <Tooltip key={session.id}>
          <TooltipTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              aria-label={session.name}
              onClick={() => onSessionClick(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSessionClick(session.id);
                }
              }}
              className={cn(
                "relative flex items-center justify-center rounded-md cursor-pointer",
                "transition-all duration-150",
                inFolder ? "p-1.5 mx-0.5" : "p-2",
                isActive
                  ? "bg-primary/20"
                  : "hover:bg-accent/50",
                !isActive && hasAgentBehavior(session) &&
                  ["waiting", "error"].includes(statusText ?? "") && "ring-1 ring-yellow-400/60"
              )}
            >
              {session.worktreeBranch ? (
                <GitBranch className={cn("w-4 h-4", iconColor)} />
              ) : session.terminalType === "agent" ? (
                <Sparkles className={cn("w-4 h-4", iconColor)} />
              ) : session.terminalType === "loop" ? (
                <MessageCircle className={cn("w-4 h-4", iconColor)} />
              ) : (
                <Terminal className={cn("w-4 h-4", iconColor)} />
              )}
              {/* Status dot overlay for agent sessions */}
              {showStatus && (
                <span className={cn(
                  "absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full",
                  statusText === "running" && "bg-green-400",
                  statusText === "waiting" && "bg-yellow-400",
                  statusText === "error" && "bg-red-400",
                  statusText === "compacting" && "bg-blue-400",
                )} />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            <div className="flex items-center gap-1.5">
              <span>{session.name}</span>
              {showStatus && (
                <span className={cn(
                  "text-[10px]",
                  statusText === "running" && "text-green-400",
                  statusText === "waiting" && "text-yellow-400",
                  statusText === "error" && "text-red-400",
                  statusText === "compacting" && "text-blue-400",
                )}>
                  {statusText}
                </span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div
        key={session.id}
        draggable={!isEditing}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleSessionDragOver(e, session.id, parentFolderId)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleSessionDrop(e, session.id, parentFolderId)}
        className={cn(
          "relative overflow-hidden",
          !isEditing && "cursor-grab active:cursor-grabbing"
        )}
      >
        {/* Drop indicator - before */}
        {showDropBefore && (
          <div className={cn(
            "absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full",
            inFolder && "left-6"
          )} />
        )}

        {/* Mobile swipe-reveal close button (positioned behind the row) */}
        {isMobile && swipedSessionId === session.id && (() => {
          const schedules = getSchedulesForSession(session.id);
          const hasActiveSchedules = schedules.some(s => s.enabled);
          if (hasActiveSchedules) return null;
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const el = swipeTouchRef.current.el;
                if (el) {
                  el.style.transition = "transform 200ms ease-out";
                  el.style.transform = "";
                }
                setSwipedSessionId(null);
                handleSessionCloseRequest(session);
              }}
              className={cn(
                "absolute right-0 top-0 bottom-0 w-[72px] rounded-r-md z-0",
                "flex items-center justify-center",
                "bg-destructive text-destructive-foreground",
                "active:bg-destructive/80 transition-colors"
              )}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          );
        })()}

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="button"
              tabIndex={isEditing ? -1 : 0}
              aria-label={session.name}
              onClick={() => {
                if (isEditing) return;
                // On mobile, tapping a swiped row resets it instead of navigating
                if (isMobile && swipedSessionId === session.id) {
                  setSwipedSessionId(null);
                  return;
                }
                onSessionClick(session.id);
              }}
              onKeyDown={(e) => {
                if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSessionClick(session.id);
                }
              }}
              onTouchStart={isMobile ? (e) => {
                // Animate and close any other swiped row
                if (swipedSessionId && swipedSessionId !== session.id) {
                  const prevEl = swipeTouchRef.current.el;
                  if (prevEl) {
                    prevEl.style.transition = "transform 200ms ease-out";
                    prevEl.style.transform = "";
                  }
                  setSwipedSessionId(null);
                }
                const touch = e.touches[0];
                swipeTouchRef.current = {
                  startX: touch.clientX,
                  startY: touch.clientY,
                  sessionId: session.id,
                  el: e.currentTarget,
                  isHorizontal: null,
                };
              } : undefined}
              onTouchMove={isMobile ? (e) => {
                const ref = swipeTouchRef.current;
                if (ref.sessionId !== session.id || !ref.el) return;
                const touch = e.touches[0];
                const deltaX = touch.clientX - ref.startX;
                const deltaY = touch.clientY - ref.startY;

                // Determine swipe direction once past threshold
                if (ref.isHorizontal === null && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
                  ref.isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
                }
                if (!ref.isHorizontal) return; // vertical scroll — don't interfere

                e.preventDefault();
                // Leftward swipe only, clamped to [-80, 0]
                const clamped = Math.max(-80, Math.min(0, deltaX));
                ref.el.style.transform = `translateX(${clamped}px)`;
                ref.el.style.transition = "none";
              } : undefined}
              onTouchEnd={isMobile ? () => {
                const ref = swipeTouchRef.current;
                if (ref.sessionId !== session.id || !ref.el) return;
                ref.el.style.transition = "transform 200ms ease-out";
                if (ref.isHorizontal) {
                  // Check final position via current transform
                  const matrix = new DOMMatrixReadOnly(getComputedStyle(ref.el).transform);
                  if (matrix.m41 < -40) {
                    // Committed swipe — snap to reveal position
                    ref.el.style.transform = "translateX(-72px)";
                    setSwipedSessionId(session.id);
                  } else {
                    // Not enough — snap back
                    ref.el.style.transform = "";
                    setSwipedSessionId(prev => prev === session.id ? null : prev);
                  }
                }
                ref.sessionId = null;
              } : undefined}
              onTouchCancel={isMobile ? () => {
                // Reset on interrupted touch (incoming call, system gesture, etc.)
                const ref = swipeTouchRef.current;
                if (ref.sessionId !== session.id || !ref.el) return;
                ref.el.style.transition = "transform 200ms ease-out";
                ref.el.style.transform = "";
                setSwipedSessionId(prev => prev === session.id ? null : prev);
                ref.sessionId = null;
              } : undefined}
              style={{
                marginLeft: depth > 0 ? `${depth * 12}px` : undefined,
                ...(isMobile ? { touchAction: "pan-y" } : {}),
              }}
              className={cn(
                "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
                "transition-all duration-200",
                inSplit && "py-1",
                isActive
                  ? "bg-primary/20 border border-border"
                  : "hover:bg-accent/50 border border-transparent",
                isDragOverSession && "bg-primary/20 border-primary/30",
                // Mobile: z-10 for swipe layering; solid bg-card only on the swiped row to cover the close button
                isMobile && "z-10",
                isMobile && swipedSessionId === session.id && "bg-card",
                !isActive && hasAgentBehavior(session) &&
                  ["waiting", "error"].includes(getAgentActivityStatus(session.id) ?? "") && "ring-2 ring-yellow-400/70 animate-pulse"
              )}
            >
            {/* Status indicator - icon colored by agent activity status */}
            {(() => {
              const iconColor = getSessionIconColor(session, isActive, getAgentActivityStatus);
              if (session.worktreeBranch) {
                return <GitBranch className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />;
              }
              if (session.terminalType === "agent") {
                return <Sparkles className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />;
              }
              if (session.terminalType === "loop") {
                return <MessageCircle className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />;
              }
              return <Terminal className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />;
            })()}

            {/* Session name - editable */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveEdit}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-input border border-primary/50 rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(session.id, "session", session.name, e);
                      }}
                      className={cn(
                        "block truncate text-xs",
                        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                      )}
                      title="Double-click to rename"
                    >
                      {session.name}
                    </span>
                    {/* Unread notification dot */}
                    {sessionUnreadMap[session.id] > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                    )}
                  </div>
                  {/* Git status metadata (branch, ahead/behind, PR, ports) */}
                  <SessionMetadataBar session={session} isCollapsed={collapsed} />
                  {/* Per-session progress bar */}
                  <SessionProgressBar sessionId={session.id} />
                </>
              )}
            </div>

            {/* Per-session status badge */}
            <SessionStatusBadge sessionId={session.id} />

            {/* Schedule count indicator */}
            {(() => {
              const schedules = getSchedulesForSession(session.id);
              const activeCount = schedules.filter(s => s.enabled).length;
              if (activeCount === 0) return null;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-0.5 text-[9px] text-primary shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      {activeCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {activeCount} scheduled command{activeCount !== 1 ? 's' : ''}
                  </TooltipContent>
                </Tooltip>
              );
            })()}

            {/* Pin indicator */}
            {session.pinned && !isEditing && (
              <Pin className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />
            )}

            {/* Close button: hover on desktop, hidden on mobile (swipe-reveal is outside row) */}
            {!isEditing && !isMobile && (() => {
              const schedules = getSchedulesForSession(session.id);
              const hasActiveSchedules = schedules.some(s => s.enabled);
              if (hasActiveSchedules) return null;
              return (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSessionCloseRequest(session);
                  }}
                  className={cn(
                    "p-0.5 rounded opacity-0 group-hover:opacity-100",
                    "hover:bg-accent transition-all duration-150",
                    "text-muted-foreground hover:text-destructive"
                  )}
                >
                  <X className="w-3 h-3" />
                </button>
              );
            })()}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            onClick={() => {
              setEditingId(session.id);
              setEditingType("session");
              setEditValue(session.name);
            }}
          >
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onSessionTogglePin(session.id)}>
            {session.pinned ? (
              <>
                <PinOff className="w-3.5 h-3.5 mr-2" />
                Unpin Session
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 mr-2" />
                Pin Session
              </>
            )}
          </ContextMenuItem>
          {folders.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Folder className="w-3.5 h-3.5 mr-2" />
                Move to Folder
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-40">
                {currentFolderId && (
                  <ContextMenuItem onClick={() => onSessionMove(session.id, null)}>
                    <X className="w-3.5 h-3.5 mr-2" />
                    Remove from Folder
                  </ContextMenuItem>
                )}
                {folders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    onClick={() => onSessionMove(session.id, folder.id)}
                    disabled={currentFolderId === folder.id}
                  >
                    <FolderOpen className="w-3.5 h-3.5 mr-2" />
                    {folder.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {/* Schedule command option */}
          {onSessionSchedule && (
            <ContextMenuItem onClick={() => onSessionSchedule(session.id)}>
              <Clock className="w-3.5 h-3.5 mr-2" />
              Schedule Command
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => handleSessionCloseRequest(session)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Close Session
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
        {/* Drop indicator - after */}
        {showDropAfter && (
          <div className={cn(
            "absolute -bottom-0.5 left-2 right-2 h-0.5 bg-primary rounded-full",
            inFolder && "left-6"
          )} />
        )}
      </div>
    );
  };

  /**
   * Renders sessions with optional tree line support.
   */
  const renderSessionsWithSplits = (
    sessionsToRender: TerminalSession[],
    options: {
      folderId: string | null;
      depth: number;
      indentStyle?: React.CSSProperties;
      // Tree line options - when provided, wraps items in tree-item divs
      treeLineLeft?: number;
      trashCount?: number; // To determine if session is last (trash comes after)
    }
  ): React.ReactNode[] => {
    const { folderId, depth, treeLineLeft, trashCount = 0 } = options;
    const elements: React.ReactNode[] = [];

    sessionsToRender.forEach((session, idx) => {
      const isLastItem = trashCount === 0 && idx === sessionsToRender.length - 1;

      // Wrap in tree-item if tree lines enabled
      if (treeLineLeft !== undefined) {
        elements.push(
          <div
            key={`tree-${session.id}`}
            className="tree-item"
            data-tree-last={isLastItem ? "true" : undefined}
            style={{
              '--tree-connector-left': `${treeLineLeft}px`,
              '--tree-connector-width': '8px',
            } as React.CSSProperties}
          >
            {renderSession(session, depth, folderId)}
          </div>
        );
      } else {
        elements.push(renderSession(session, depth, folderId));
      }
    });

    return elements;
  };

  return (
    <>
    <TooltipProvider delayDuration={200}>
    <div
      className={cn(
        "h-full flex flex-col bg-card/50 backdrop-blur-md border-r border-border",
        "transition-[width] duration-200 relative shrink-0",
        "pl-safe-left",
        isResizing && "select-none"
      )}
      style={{ width: collapsed ? COLLAPSED_SIDEBAR_WIDTH : width }}
    >
        {/* Resize handle */}
        {!collapsed && (
          <div
            className={cn(
              "absolute top-0 right-0 w-1 h-full cursor-ew-resize z-10",
              "hover:bg-primary/50 transition-colors",
              isResizing && "bg-primary/50"
            )}
            onMouseDown={handleResizeStart}
          />
        )}
        {/* Header */}
        <div className={cn(
          "flex items-center border-b border-border h-10 shrink-0",
          collapsed ? "justify-center px-1" : "justify-between px-3"
        )}>
          {collapsed ? (
            // Collapsed header - just toggle button
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => onCollapsedChange(false)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <PanelLeft className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          ) : (
            // Expanded header
            <>
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">Sessions</span>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  onClick={() => setCreatingFolder(true)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Folder className="w-3.5 h-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={onQuickNewSession}>
                      <Terminal className="w-3.5 h-3.5 mr-2" />
                      New Terminal
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onNewAgent}>
                      <Sparkles className="w-3.5 h-3.5 mr-2" />
                      New Agent
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeFolderId && folderHasRepo(activeFolderId)) {
                          onFolderNewWorktree(activeFolderId);
                        }
                      }}
                      disabled={!activeFolderId || !folderHasRepo(activeFolderId)}
                    >
                      <GitBranch className="w-3.5 h-3.5 mr-2" />
                      New Worktree
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onNewSession}>
                      <Settings className="w-3.5 h-3.5 mr-2" />
                      Advanced...
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  onClick={() => onCollapsedChange(true)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>

      {/* Session List */}
      <div
          className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5"
          onDragOver={(e) => handleDragOver(e, null)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, null)}
        >
          {activeSessions.length === 0 ? (
            collapsed ? (
              // Collapsed empty state - just show plus button
              <div className="flex flex-col items-center py-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={onQuickNewSession}
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">New session</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <div className="text-center py-8 px-2">
                <Terminal className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground mb-2">No sessions</p>
                <div className="flex flex-col gap-1 items-center">
                  <Button
                    onClick={onQuickNewSession}
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary hover:text-primary/80 hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    New Session
                  </Button>
                  <button
                    onClick={onNewSession}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Advanced options...
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              {/* Project tree (groups + projects). Replaces the legacy folder
                  tree rendering path as of Phase G1. */}
              {!collapsed && (
                <ProjectTreeSidebar
                  getProjectRepoStats={getFolderRepoStats}
                  onOpenPreferences={onOpenNodePreferences}
                  onSessionClick={onSessionClick}
                  onSessionClose={(sid) => onSessionClose(sid)}
                  onSessionStartEdit={() => {}}
                  onSessionRename={onSessionRename}
                  folderHasPreferences={folderHasPreferences}
                  onProjectNewSession={onFolderNewSession}
                  onProjectNewAgent={onFolderNewAgent}
                  onProjectResumeClaudeSession={onFolderResumeClaudeSession}
                  onProjectAdvancedSession={onFolderAdvancedSession}
                  onProjectNewWorktree={onFolderNewWorktree}
                  onProjectOpenSecrets={(fid) => {
                    setSecretsModalFolderId(fid);
                    setSecretsModalOpen(true);
                  }}
                  onProjectOpenRepository={(fid, name) =>
                    onFolderSettings(fid, name, "repository")
                  }
                  onProjectOpenFolderInOS={handleOpenFolder}
                  onProjectViewIssues={onViewIssues}
                  onProjectViewPRs={onViewPRs}
                  onSessionTogglePin={onSessionTogglePin}
                  onSessionMove={onSessionMove}
                  onSessionReorder={onSessionReorder}
                  onSessionSchedule={onSessionSchedule}
                />
              )}
            </>
          )}
      </div>

      {/* Files Section - default + pinned files for active folder */}
      {getFolderPinnedFiles && onOpenPinnedFile && (
        <FilesSection
          activeFolderId={activeFolderId}
          collapsed={collapsed}
          getFolderPinnedFiles={getFolderPinnedFiles}
          onOpenFile={onOpenPinnedFile}
          activeSessionId={activeSessionId}
        />
      )}

      {/* MCP Servers Section - only show when agent session is selected */}
      {isAgentSession && mcpSupported && (
        <MCPServersSection collapsed={collapsed} />
      )}

      {/* Footer - hide when collapsed */}
      {!collapsed && (
        <div className="px-3 py-1.5 border-t border-border space-y-1">
          {/* Profiles button */}
          {onProfilesOpen && (
            <button
              onClick={onProfilesOpen}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Profiles</span>
              {profileCount > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {profileCount}
                </span>
              )}
            </button>
          )}
          {/* Ports button */}
          {onPortsOpen && (
            <button
              onClick={onPortsOpen}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Ports</span>
              {allocations.length > 0 && (
                <span className={cn(
                  "ml-auto text-[10px] px-1.5 py-0.5 rounded",
                  activePorts.size > 0
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground bg-muted"
                )}>
                  {activePorts.size > 0 ? `${activePorts.size}/${allocations.length}` : allocations.length}
                </span>
              )}
            </button>
          )}
          {/* Trash button - only show when there are items */}
          {trashCount > 0 && (
            <button
              onClick={onTrashOpen}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Trash</span>
              <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {trashCount}
              </span>
            </button>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>New session</span>
            <kbd className="px-1 py-0.5 bg-muted rounded">⌘↵</kbd>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>

      {/* Secrets configuration modal */}
      <SecretsConfigModal
        open={secretsModalOpen}
        onClose={() => {
          setSecretsModalOpen(false);
          setSecretsModalFolderId(null);
        }}
        initialFolderId={secretsModalFolderId}
      />
    </>
  );
}
