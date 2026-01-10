"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X, Plus, Terminal, Settings,
  Folder, FolderOpen, Pencil, Trash2, Sparkles, GitBranch,
  PanelLeftClose, PanelLeft,
  SplitSquareHorizontal, SplitSquareVertical, Minus,
  GitPullRequest, CircleDot, Clock, CalendarClock, KeyRound, Fingerprint, Network,
  Brain, RefreshCw, BookOpen, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
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
import { useSplitContext } from "@/contexts/SplitContext";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { SecretsConfigModal } from "@/components/secrets/SecretsConfigModal";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { useProfileContext } from "@/contexts/ProfileContext";
import { usePortContext } from "@/contexts/PortContext";

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
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onSessionReorder: (sessionIds: string[]) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
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
  onFolderEmpty: (folderId: string) => void;
  onEmptyTrash: (folderId: string) => void;
  trashCount: number;
  onTrashOpen: () => void;
  onSessionSchedule?: (sessionId: string) => void;
  onSessionSchedulesView?: (sessionId: string, sessionName: string) => void;
  onSchedulesOpen?: () => void;
  onProfilesOpen?: () => void;
  onPortsOpen?: () => void;
  onViewIssues?: (folderId: string) => void;
  onViewPRs?: (folderId: string) => void;
  onFolderReinitOrchestrator?: (folderId: string) => void;
  onOrchestratorReinstallHooks?: (folderId: string) => void;
  onFolderKnowledge?: (folderId: string, folderName: string) => void;
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
  onSessionMove,
  onSessionReorder,
  onNewSession,
  onQuickNewSession,
  onFolderCreate,
  onFolderRename,
  onFolderDelete,
  onFolderToggle,
  onFolderClick,
  onFolderSettings,
  onFolderNewSession,
  onFolderAdvancedSession,
  onFolderNewWorktree,
  onFolderMove,
  onFolderReorder,
  onFolderEmpty,
  onEmptyTrash,
  trashCount,
  onTrashOpen,
  onSessionSchedule,
  onSessionSchedulesView,
  onSchedulesOpen,
  onProfilesOpen,
  onPortsOpen,
  onViewIssues,
  onViewPRs,
  onFolderReinitOrchestrator,
  onOrchestratorReinstallHooks,
  onFolderKnowledge,
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
  const { profileCount } = useProfileContext();
  const { allocations, activePorts } = usePortContext();

  // Touch drag state for mobile
  const touchDragRef = useRef<{
    type: "folder" | "session" | null;
    id: string | null;
    startX: number;
    startY: number;
    element: HTMLElement | null;
    clone: HTMLElement | null;
    isDragging: boolean; // True once long-press delay completes
  }>({ type: null, id: null, startX: 0, startY: 0, element: null, clone: null, isDragging: false });
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

  // Cleanup longPressTimer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  // Split context for managing split groups
  const {
    createSplit,
    removeFromSplit,
    getSplitForSession,
  } = useSplitContext();

  // Schedule context for showing schedule indicators
  const { schedules, getSchedulesForSession } = useScheduleContext();
  const activeScheduleCount = schedules.filter(s => s.enabled).length;

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Handler for session close - worktree sessions are automatically trashed by SessionManager
  const handleSessionCloseRequest = useCallback((session: TerminalSession) => {
    // Close directly - SessionManager handles trashing worktree sessions automatically
    onSessionClose(session.id);
  }, [onSessionClose]);

  // Separate orchestrator sessions (Master Control is pinned to top)
  const masterControlSession = activeSessions.find(
    (s) => s.isOrchestratorSession && !s.folderId
  );

  // Sessions not in any folder - use session.folderId directly for accurate rendering
  // Exclude orchestrator sessions from regular root sessions
  const rootSessions = activeSessions.filter(
    (s) => !s.folderId && !s.isOrchestratorSession
  );

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

  // Touch handlers for mobile drag-and-drop with long-press delay
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
        touchDragRef.current = { type: null, id: null, startX: 0, startY: 0, element: null, clone: null, isDragging: false };
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
    touchDragRef.current = { type: null, id: null, startX: 0, startY: 0, element: null, clone: null, isDragging: false };
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

    // Check if in the same folder - use session.folderId directly
    const draggedSession = activeSessions.find((s) => s.id === draggedId);
    const draggedFolderId = draggedSession?.folderId || null;
    if (draggedFolderId !== targetFolderId) {
      // Different folder - move to target folder
      onSessionMove(draggedId, targetFolderId);
    } else {
      // Same folder - reorder
      const sessionsInFolder = activeSessions.filter(
        (s) => (s.folderId || null) === targetFolderId
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
      folders.forEach((folder) => {
        if (folder.id === targetFolderId) {
          // Use the reordered list for the target folder
          fullOrder.push(...newOrder);
        } else {
          // Keep existing order for other folders
          const otherFolderSessions = activeSessions
            .filter((s) => s.folderId === folder.id)
            .map((s) => s.id);
          fullOrder.push(...otherFolderSessions);
        }
      });

      // Add root sessions
      if (targetFolderId === null) {
        // Reordering root sessions - use new order
        fullOrder.push(...newOrder);
      } else {
        // Keep existing order for root sessions
        const rootSessionIds = activeSessions
          .filter((s) => !s.folderId)
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

    // Check if dragged session is in the same folder - use session.folderId directly
    const draggedSession = draggedSessionId ? activeSessions.find((s) => s.id === draggedSessionId) : null;
    const draggedFolderId = draggedSession?.folderId || null;
    if (draggedFolderId !== targetFolderId) {
      // Different folder - treat as folder drop
      setDragOverFolderId(targetFolderId);
      setDropTargetId(null);
      setDropPosition(null);
      return;
    }

    // Same folder - show reorder indicator
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
    const currentFolderId = session.folderId; // Used in context menu - use session.folderId directly
    const isDragOverSession = parentFolderId !== null && dragOverFolderId === parentFolderId;
    const isDropTarget = dropTargetId === session.id;
    const showDropBefore = isDropTarget && dropPosition === "before";
    const showDropAfter = isDropTarget && dropPosition === "after";

    // Collapsed view - show only status indicator with tooltip
    if (collapsed) {
      return (
        <Tooltip key={session.id}>
          <TooltipTrigger asChild>
            <div
              role="button"
              tabIndex={0}
              aria-label={session.name}
              draggable
              onDragStart={(e) => handleDragStart(e, session.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleSessionDragOver(e, session.id, parentFolderId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleSessionDrop(e, session.id, parentFolderId)}
              onClick={() => onSessionClick(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSessionClick(session.id);
                }
              }}
              className={cn(
                "relative flex items-center justify-center p-2 rounded-md cursor-pointer",
                "transition-all duration-200",
                inFolder && "ml-2",
                isActive
                  ? "bg-primary/20 border border-border"
                  : "hover:bg-accent/50 border border-transparent",
                isDragOverSession && "bg-primary/20 border-primary/30"
              )}
            >
              {/* Drop indicator - before */}
              {showDropBefore && (
                <div className="absolute -top-0.5 left-1 right-1 h-0.5 bg-primary rounded-full" />
              )}
              {session.isOrchestratorSession ? (
                <Brain
                  className={cn(
                    "w-4 h-4",
                    isActive
                      ? "text-purple-500 animate-pulse"
                      : "text-purple-400/70"
                  )}
                />
              ) : session.agentProvider && session.agentProvider !== "none" ? (
                <Bot
                  className={cn(
                    "w-4 h-4",
                    isActive
                      ? "text-blue-500 animate-pulse"
                      : "text-blue-400/70"
                  )}
                />
              ) : (
                <Terminal
                  className={cn(
                    "w-4 h-4",
                    isActive
                      ? "text-primary animate-pulse"
                      : "text-muted-foreground"
                  )}
                />
              )}
              {/* Drop indicator - after */}
              {showDropAfter && (
                <div className="absolute -bottom-0.5 left-1 right-1 h-0.5 bg-primary rounded-full" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {session.name}
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
          "relative",
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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="button"
              tabIndex={isEditing ? -1 : 0}
              aria-label={session.name}
              onClick={() => !isEditing && onSessionClick(session.id)}
              onKeyDown={(e) => {
                if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSessionClick(session.id);
                }
              }}
              style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
              className={cn(
                "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
                "transition-all duration-200",
                inSplit && "py-1",
                isActive
                  ? "bg-primary/20 border border-border"
                  : "hover:bg-accent/50 border border-transparent",
                isDragOverSession && "bg-primary/20 border-primary/30"
              )}
            >
            {/* Status indicator - Brain for orchestrator, Bot for agent, Terminal for shell */}
            {session.isOrchestratorSession ? (
              <Brain
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  isActive
                    ? "text-purple-500"
                    : "text-purple-400/70"
                )}
              />
            ) : session.agentProvider && session.agentProvider !== "none" ? (
              <Bot
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  isActive
                    ? "text-blue-500"
                    : "text-blue-400/70"
                )}
              />
            ) : (
              <Terminal
                className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              />
            )}

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
                  {/* Git branch indicator */}
                  {session.worktreeBranch && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground truncate">
                      <GitBranch className="w-2.5 h-2.5" />
                      {session.worktreeBranch}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Schedule count indicator - right side, clickable */}
            {(() => {
              const schedules = getSchedulesForSession(session.id);
              const activeCount = schedules.filter(s => s.enabled).length;
              if (activeCount === 0) return null;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSessionSchedulesView?.(session.id, session.name);
                      }}
                      className="flex items-center gap-0.5 text-[9px] text-primary shrink-0 hover:text-primary/80 transition-colors"
                    >
                      <Clock className="w-2.5 h-2.5" />
                      {activeCount}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {activeCount} scheduled command{activeCount !== 1 ? 's' : ''} - click to view
                  </TooltipContent>
                </Tooltip>
              );
            })()}

            {/* Close button - hidden for orchestrator sessions and sessions with scheduled commands */}
            {!isEditing && !session.isOrchestratorSession && (() => {
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
          {session.isOrchestratorSession ? (
            /* Orchestrator session context menu */
            <>
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
              {session.folderId && onFolderReinitOrchestrator && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => onFolderReinitOrchestrator(session.folderId!)}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-2" />
                    Reinitialize
                  </ContextMenuItem>
                  {onOrchestratorReinstallHooks && (
                    <ContextMenuItem
                      onClick={() => onOrchestratorReinstallHooks(session.folderId!)}
                    >
                      <Settings className="w-3.5 h-3.5 mr-2" />
                      Reinstall Hooks
                    </ContextMenuItem>
                  )}
                </>
              )}
            </>
          ) : (
            /* Regular session context menu */
            <>
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
              {/* Split options */}
              {(() => {
                const splitGroup = getSplitForSession(session.id);
                if (splitGroup) {
                  // Session is in a split - show unsplit option
                  return (
                    <ContextMenuItem
                      onClick={() => removeFromSplit(session.id)}
                    >
                      <Minus className="w-3.5 h-3.5 mr-2" />
                      Unsplit
                    </ContextMenuItem>
                  );
                } else {
                  // Session is not in a split - show split options
                  return (
                    <>
                      <ContextMenuItem
                        onClick={() => createSplit(session.id, "horizontal")}
                      >
                        <SplitSquareHorizontal className="w-3.5 h-3.5 mr-2" />
                        Split Horizontal
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => createSplit(session.id, "vertical")}
                      >
                        <SplitSquareVertical className="w-3.5 h-3.5 mr-2" />
                        Split Vertical
                      </ContextMenuItem>
                    </>
                  );
                }
              })()}
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => handleSessionCloseRequest(session)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Close Session
              </ContextMenuItem>
            </>
          )}
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
   * Renders sessions with split group handling and optional tree line support.
   * Consolidates duplicate logic from folder and root session rendering.
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
    const { folderId, depth, indentStyle, treeLineLeft, trashCount = 0 } = options;
    const renderedSessionIds = new Set<string>();
    const elements: React.ReactNode[] = [];

    // Build list of elements to render (for determining last item)
    const itemsToRender: { type: 'session' | 'split'; session?: TerminalSession; splitGroup?: unknown }[] = [];
    sessionsToRender.forEach((session) => {
      if (renderedSessionIds.has(session.id)) return;
      const splitGroup = getSplitForSession(session.id);
      if (splitGroup) {
        const splitSessions = splitGroup.sessions
          .sort((a, b) => a.splitOrder - b.splitOrder)
          .map((ss) => sessions.find((s) => s.id === ss.sessionId))
          .filter((s): s is TerminalSession => {
            if (!s) return false;
            return folderId !== null ? s.folderId === folderId : !s.folderId;
          });
        splitSessions.forEach((s) => renderedSessionIds.add(s.id));
        if (splitSessions.length > 0) {
          itemsToRender.push({ type: 'split', splitGroup });
        }
      } else {
        renderedSessionIds.add(session.id);
        itemsToRender.push({ type: 'session', session });
      }
    });

    // Reset for actual rendering
    renderedSessionIds.clear();

    sessionsToRender.forEach((session) => {
      // Skip if already rendered as part of a split group
      if (renderedSessionIds.has(session.id)) return;

      const splitGroup = getSplitForSession(session.id);
      const currentIndex = elements.length;
      const isLastItem = trashCount === 0 && currentIndex === itemsToRender.length - 1;

      if (splitGroup) {
        // Render the entire split group
        const splitSessions = splitGroup.sessions
          .sort((a, b) => a.splitOrder - b.splitOrder)
          .map((ss) => sessions.find((s) => s.id === ss.sessionId))
          .filter((s): s is TerminalSession => {
            if (!s) return false;
            return folderId !== null ? s.folderId === folderId : !s.folderId;
          });

        // Mark all sessions in this split as rendered
        splitSessions.forEach((s) => renderedSessionIds.add(s.id));

        if (splitSessions.length > 0) {
          const splitElement = (
            <div
              key={`split-${splitGroup.id}`}
              style={indentStyle}
              className={cn(
                "relative",
                splitGroup.direction === "horizontal"
                  ? "border-l-2 border-primary/40 pl-1 space-y-0.5"
                  : "flex items-stretch gap-1"
              )}
            >
              {splitGroup.direction === "vertical" && (
                <div className="absolute -top-0.5 left-0 right-0 flex items-center gap-0.5 text-[9px] text-primary/60">
                  <SplitSquareVertical className="w-2.5 h-2.5" />
                  <span>Split</span>
                </div>
              )}
              {splitSessions.map((s, idx) => (
                <div
                  key={s.id}
                  className={cn(
                    splitGroup.direction === "vertical" && "flex-1 min-w-0",
                    splitGroup.direction === "vertical" && idx > 0 && "border-l border-border"
                  )}
                >
                  {renderSession(s, 0, folderId, true)}
                </div>
              ))}
            </div>
          );

          // Wrap in tree-item if tree lines enabled
          if (treeLineLeft !== undefined) {
            elements.push(
              <div
                key={`tree-split-${splitGroup.id}`}
                className="tree-item"
                data-tree-last={isLastItem ? "true" : undefined}
                style={{
                  '--tree-connector-left': `${treeLineLeft}px`,
                  '--tree-connector-width': '8px',
                } as React.CSSProperties}
              >
                {splitElement}
              </div>
            );
          } else {
            elements.push(splitElement);
          }
        }
      } else {
        // Render as a regular session
        renderedSessionIds.add(session.id);

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
          "flex items-center border-b border-border",
          collapsed ? "justify-center px-1 py-2" : "justify-between px-3 py-2"
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
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={onQuickNewSession}>
                      <Terminal className="w-3.5 h-3.5 mr-2" />
                      Quick Terminal
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
          {activeSessions.length === 0 && folders.length === 0 && !creatingFolder ? (
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
              {/* New folder input (at root level, only when not collapsed) */}
              {creatingFolder && !creatingSubfolderId && !collapsed && (
                <div className="flex items-center gap-1 px-2 py-1">
                  <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                  <input
                    ref={folderInputRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={handleFolderKeyDown}
                    onBlur={() => {
                      if (!newFolderName.trim()) {
                        setCreatingFolder(false);
                        setCreatingSubfolderId(null);
                      } else {
                        handleCreateFolder();
                      }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-input border border-primary/50 rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              {/* Master Control - pinned to top */}
              {masterControlSession && (
                <div className="mb-2 pb-2 border-b border-border/50">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        onClick={() => onSessionClick(masterControlSession.id)}
                        className={cn(
                          "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
                          "hover:bg-muted/50 transition-colors",
                          activeSessionId === masterControlSession.id && "bg-muted"
                        )}
                      >
                        <Brain
                          className={cn(
                            "w-4 h-4 shrink-0",
                            activeSessionId === masterControlSession.id
                              ? "text-purple-500"
                              : "text-purple-400/70"
                          )}
                        />
                        <span
                          className={cn(
                            "text-xs truncate flex-1",
                            activeSessionId === masterControlSession.id
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {masterControlSession.name}
                        </span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() => {
                          setEditingId(masterControlSession.id);
                          setEditingType("session");
                          setEditValue(masterControlSession.name);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-2" />
                        Rename
                      </ContextMenuItem>
                      {onFolderReinitOrchestrator && (
                        <ContextMenuItem
                          onClick={() => onFolderReinitOrchestrator("")}
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-2" />
                          Reinitialize
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                </div>
              )}

              {/* Recursive folder rendering */}
              {folderTree.map((folderNode) => {
                // Helper to count sessions recursively in a folder and all descendants
                const countSessionsRecursively = (node: FolderNode): number => {
                  const directSessions = activeSessions.filter(s => s.folderId === node.id).length;
                  const childSessions = node.children.reduce(
                    (sum, child) => sum + countSessionsRecursively(child),
                    0
                  );
                  return directSessions + childSessions;
                };

                const renderFolderNode = (node: FolderNode): React.ReactNode => {
                  // Use session.folderId directly for accurate folder membership
                  const folderSessions = activeSessions.filter(
                    (s) => s.folderId === node.id
                  );
                  const isEditingFolder = editingId === node.id && editingType === "folder";
                  const isDragOver = dragOverFolderId === node.id;
                  const isActive = activeFolderId === node.id;
                  const hasPrefs = folderHasPreferences(node.id);
                  const isBeingDragged = draggingFolderId === node.id;
                  const canDropHere = !draggingFolderId ||
                    (draggingFolderId !== node.id && !isDescendantOf(node.id, draggingFolderId));
                  // Folder reorder indicators
                  const isFolderDropTarget = dropTargetFolderId === node.id;
                  const showFolderDropBefore = isFolderDropTarget && dropFolderPosition === "before";
                  const showFolderDropAfter = isFolderDropTarget && dropFolderPosition === "after";

                  // Count total sessions in this folder and all descendants
                  const totalSessions = countSessionsRecursively(node);

                  // Check if this is a .trash folder
                  const isTrashFolder = node.name === ".trash";

                  // Collapsed sidebar view - show folder icon only
                  if (collapsed) {
                    return (
                      <div key={node.id} className="space-y-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              data-folder-id={node.id}
                              data-folder-parent-id={node.parentId || ""}
                              onDragOver={(e) => handleDragOver(e, node.id)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, node.id)}
                              onTouchStart={(e) => handleFolderTouchStart(e, node.id)}
                              onTouchMove={handleFolderTouchMove}
                              onTouchEnd={handleFolderTouchEnd}
                              onClick={() => {
                                onFolderClick(node.id);
                                onFolderToggle(node.id);
                              }}
                              style={{ marginLeft: node.depth > 0 ? `${node.depth * 8}px` : undefined }}
                              className={cn(
                                "flex items-center justify-center p-2 rounded-md cursor-pointer",
                                "hover:bg-accent/50 transition-all duration-150",
                                isDragOver && canDropHere && "bg-primary/20 border border-primary/30",
                                isActive && "bg-primary/10",
                                isBeingDragged && "opacity-50"
                              )}
                            >
                              {node.collapsed && !isActive ? (
                                <Folder
                                  className={cn(
                                    "w-4 h-4",
                                    isTrashFolder
                                      ? "text-destructive/70"
                                      : isActive
                                        ? "text-primary fill-primary"
                                        : "text-primary"
                                  )}
                                />
                              ) : (
                                <FolderOpen
                                  className={cn(
                                    "w-4 h-4",
                                    isTrashFolder
                                      ? "text-destructive/70"
                                      : isActive
                                        ? "text-primary fill-primary"
                                        : "text-primary"
                                  )}
                                />
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            {node.name}{totalSessions > 0 ? ` (${totalSessions})` : ""}
                          </TooltipContent>
                        </Tooltip>
                        {/* Child folders and sessions in collapsed view */}
                        {!node.collapsed && (
                          <>
                            {node.children.map((child) => renderFolderNode(child))}
                            {folderSessions.map((session) => renderSession(session, node.depth + 1, node.id))}
                          </>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={node.id} className="space-y-0.5">
                      <div
                        data-folder-id={node.id}
                        data-folder-parent-id={node.parentId || ""}
                        draggable={!isEditingFolder}
                        onDragStart={(e) => handleFolderDragStart(e, node.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleFolderDragOver(e, node.id, node.parentId)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleFolderDrop(e, node.id)}
                        onTouchStart={(e) => handleFolderTouchStart(e, node.id)}
                        onTouchMove={handleFolderTouchMove}
                        onTouchEnd={handleFolderTouchEnd}
                        className={cn(
                          "relative",
                          !isEditingFolder && "cursor-grab active:cursor-grabbing",
                          isBeingDragged && "opacity-50"
                        )}
                      >
                        {/* Drop indicator - before folder */}
                        {showFolderDropBefore && (
                          <div className="absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
                        )}
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <div
                              role="button"
                              tabIndex={isEditingFolder ? -1 : 0}
                              aria-label={node.name}
                              style={{ marginLeft: node.depth > 0 ? `${node.depth * 12}px` : undefined }}
                              className={cn(
                                "group flex items-center gap-1.5 px-2 py-1 rounded-md",
                                "hover:bg-accent/50 transition-all duration-150",
                                isDragOver && canDropHere && "bg-primary/20 border border-primary/30",
                                isActive && "bg-primary/10"
                              )}
                              onClick={() => {
                                onFolderClick(node.id);
                                onFolderToggle(node.id);
                              }}
                              onKeyDown={(e) => {
                                if (!isEditingFolder && (e.key === "Enter" || e.key === " ")) {
                                  e.preventDefault();
                                  onFolderClick(node.id);
                                  onFolderToggle(node.id);
                                }
                              }}
                            >
                            {node.collapsed && !isActive ? (
                              <Folder
                                className={cn(
                                  "w-3.5 h-3.5 shrink-0",
                                  isTrashFolder ? "text-destructive/70" : "text-primary"
                                )}
                              />
                            ) : (
                              <FolderOpen
                                className={cn(
                                  "w-3.5 h-3.5 shrink-0",
                                  isTrashFolder
                                    ? "text-destructive/70"
                                    : isActive
                                      ? "text-primary fill-primary"
                                      : "text-primary"
                                )}
                              />
                            )}

                            {isEditingFolder ? (
                              <input
                                ref={inputRef}
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onBlur={handleSaveEdit}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 bg-input border border-primary/50 rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            ) : (
                              <span
                                className={cn(
                                  "flex-1 text-xs truncate",
                                  isTrashFolder ? "text-destructive/70" : "text-foreground"
                                )}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEdit(node.id, "folder", node.name, e);
                                }}
                                title="Double-click to rename"
                              >
                                {node.name}
                              </span>
                            )}

                            {/* Repo stats badges - rolled up from collapsed descendants */}
                            {(() => {
                              const repoStats = getRolledUpStats(node.id);
                              if (!repoStats) return null;
                              // Only show badges container if there's at least one non-zero value
                              const hasAnyStats = repoStats.prCount > 0 || repoStats.issueCount > 0 || repoStats.hasChanges;
                              if (!hasAnyStats) return null;
                              return (
                                <div className="flex items-center gap-1 shrink-0">
                                  {/* PR count - primary color, placeholder if zero for alignment */}
                                  {repoStats.prCount > 0 ? (
                                    <span className="flex items-center gap-0.5 text-[9px] text-primary">
                                      <GitPullRequest className="w-2.5 h-2.5" />
                                      {repoStats.prCount}
                                    </span>
                                  ) : repoStats.issueCount > 0 ? (
                                    <span className="flex items-center gap-0.5 text-[9px] invisible" aria-hidden="true">
                                      <GitPullRequest className="w-2.5 h-2.5" />
                                      0
                                    </span>
                                  ) : null}
                                  {/* Issue count - chart-2 color (cyan/teal) for distinction */}
                                  {repoStats.issueCount > 0 ? (
                                    <span className="flex items-center gap-0.5 text-[9px] text-chart-2">
                                      <CircleDot className="w-2.5 h-2.5" />
                                      {repoStats.issueCount}
                                    </span>
                                  ) : repoStats.prCount > 0 ? (
                                    <span className="flex items-center gap-0.5 text-[9px] invisible" aria-hidden="true">
                                      <CircleDot className="w-2.5 h-2.5" />
                                      0
                                    </span>
                                  ) : null}
                                  {repoStats.hasChanges && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                  )}
                                </div>
                              );
                            })()}

                            {totalSessions > 0 ? (
                              <span className={cn(
                                "text-[10px] ml-auto",
                                isTrashFolder ? "text-destructive/50" : "text-muted-foreground"
                              )}>
                                {totalSessions}
                              </span>
                            ) : (
                              <span className="text-[10px] ml-auto invisible" aria-hidden="true">0</span>
                            )}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          {isTrashFolder ? (
                            /* Simplified context menu for .trash folders */
                            <>
                              <ContextMenuItem onClick={() => {
                                onFolderClick(node.id);
                                if (node.collapsed) onFolderToggle(node.id);
                              }}>
                                <FolderOpen className="w-3.5 h-3.5 mr-2" />
                                View Contents
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => onFolderEmpty(node.id)}
                                disabled={totalSessions === 0}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Empty Trash
                              </ContextMenuItem>
                            </>
                          ) : (
                            /* Regular folder context menu */
                            <>
                              <ContextMenuItem onClick={() => onFolderNewSession(node.id, "agent")}>
                                <Bot className="w-3.5 h-3.5 mr-2" />
                                New Agent
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => onFolderNewSession(node.id, "terminal")}>
                                <Terminal className="w-3.5 h-3.5 mr-2" />
                                New Terminal
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onFolderAdvancedSession(node.id)}>
                                <Sparkles className="w-3.5 h-3.5 mr-2" />
                                Advanced...
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => onFolderNewWorktree(node.id)}
                                disabled={!folderHasRepo(node.id)}
                                className={!folderHasRepo(node.id) ? "opacity-50" : ""}
                                title={!folderHasRepo(node.id) ? "Link a repository in folder preferences first" : undefined}
                              >
                                <GitBranch className="w-3.5 h-3.5 mr-2" />
                                New Worktree
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => handleStartSubfolderCreate(node.id)}>
                                <Folder className="w-3.5 h-3.5 mr-2" />
                                New Subfolder
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => onFolderSettings(node.id, node.name)}>
                                <Settings className="w-3.5 h-3.5 mr-2" />
                                Preferences
                                {hasPrefs && (
                                  <span className="ml-auto text-[10px] text-primary">Custom</span>
                                )}
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  setSecretsModalFolderId(node.id);
                                  setSecretsModalOpen(true);
                                }}
                              >
                                <KeyRound className="w-3.5 h-3.5 mr-2" />
                                Secrets
                                {folderConfigs.has(node.id) && folderConfigs.get(node.id)?.enabled && (
                                  <span className="ml-auto text-[10px] text-primary">Active</span>
                                )}
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => onFolderSettings(node.id, node.name, "repository")}
                              >
                                <GitBranch className="w-3.5 h-3.5 mr-2" />
                                Repository
                                {folderHasRepo(node.id) && (
                                  <span className="ml-auto text-[10px] text-primary">Linked</span>
                                )}
                              </ContextMenuItem>
                              {onFolderKnowledge && (
                                <ContextMenuItem
                                  onClick={() => onFolderKnowledge(node.id, node.name)}
                                >
                                  <BookOpen className="w-3.5 h-3.5 mr-2" />
                                  View Knowledge
                                </ContextMenuItem>
                              )}
                              {onViewIssues && folderHasRepo(node.id) && (
                                <ContextMenuItem
                                  onClick={() => onViewIssues(node.id)}
                                >
                                  <CircleDot className="w-3.5 h-3.5 mr-2" />
                                  View Issues
                                </ContextMenuItem>
                              )}
                              {onViewPRs && folderHasRepo(node.id) && (
                                <ContextMenuItem
                                  onClick={() => onViewPRs(node.id)}
                                >
                                  <GitPullRequest className="w-3.5 h-3.5 mr-2" />
                                  View PRs
                                </ContextMenuItem>
                              )}
                              {(onFolderReinitOrchestrator || onOrchestratorReinstallHooks) && (
                                <>
                                  <ContextMenuSeparator />
                                  {onFolderReinitOrchestrator && (
                                    <ContextMenuItem
                                      onClick={() => onFolderReinitOrchestrator(node.id)}
                                    >
                                      <RefreshCw className="w-3.5 h-3.5 mr-2" />
                                      Reinitialize Orchestrator
                                    </ContextMenuItem>
                                  )}
                                  {onOrchestratorReinstallHooks && (
                                    <ContextMenuItem
                                      onClick={() => onOrchestratorReinstallHooks(node.id)}
                                    >
                                      <Settings className="w-3.5 h-3.5 mr-2" />
                                      Reinstall Hooks
                                    </ContextMenuItem>
                                  )}
                                </>
                              )}
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  setEditingId(node.id);
                                  setEditingType("folder");
                                  setEditValue(node.name);
                                }}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-2" />
                                Rename
                              </ContextMenuItem>
                              {node.parentId && (
                                <ContextMenuItem onClick={() => onFolderMove(node.id, null)}>
                                  <FolderOpen className="w-3.5 h-3.5 mr-2" />
                                  Move to Root
                                </ContextMenuItem>
                              )}
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => onFolderDelete(node.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Delete
                              </ContextMenuItem>
                            </>
                          )}
                        </ContextMenuContent>
                        </ContextMenu>
                        {/* Drop indicator - after folder */}
                        {showFolderDropAfter && (
                          <div className="absolute -bottom-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
                        )}
                      </div>

                      {/* Subfolder creation input */}
                      {creatingFolder && creatingSubfolderId === node.id && !node.collapsed && (
                        <div
                          className="flex items-center gap-1 px-2 py-1"
                          style={{ marginLeft: `${(node.depth + 1) * 12}px` }}
                        >
                          <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                          <input
                            ref={folderInputRef}
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={handleFolderKeyDown}
                            onBlur={() => {
                              if (!newFolderName.trim()) {
                                setCreatingFolder(false);
                                setCreatingSubfolderId(null);
                              } else {
                                handleCreateFolder();
                              }
                            }}
                            placeholder="Subfolder name..."
                            className="flex-1 bg-input border border-primary/50 rounded px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}

                      {/* Child folders and sessions when not collapsed */}
                      {!node.collapsed && (
                        <div
                          className="tree-children"
                          style={{
                            '--tree-line-left': `${node.depth * 12 + 8 + 7}px`,
                          } as React.CSSProperties}
                        >
                          {/* Render child folders with tree-item wrappers */}
                          {node.children.map((child, idx) => {
                            const isLastChild = folderSessions.length === 0 &&
                              getFolderTrashCount(node.id) === 0 &&
                              idx === node.children.length - 1;
                            return (
                              <div
                                key={child.id}
                                className="tree-item"
                                data-tree-last={isLastChild ? "true" : undefined}
                                style={{
                                  '--tree-connector-left': `${node.depth * 12 + 8 + 7}px`,
                                  '--tree-connector-width': '8px',
                                } as React.CSSProperties}
                              >
                                {renderFolderNode(child)}
                              </div>
                            );
                          })}
                          {/* Sessions with split group handling and tree lines */}
                          {renderSessionsWithSplits(folderSessions, {
                            folderId: node.id,
                            depth: node.depth + 1,
                            indentStyle: { marginLeft: `${(node.depth + 1) * 12}px` },
                            treeLineLeft: node.depth * 12 + 8 + 7,
                            trashCount: getFolderTrashCount(node.id),
                          })}
                          {/* Trash indicator for folder - always last when present */}
                          {getFolderTrashCount(node.id) > 0 && (
                            <div
                              className="tree-item"
                              data-tree-last="true"
                              style={{
                                '--tree-connector-left': `${node.depth * 12 + 8 + 7}px`,
                                '--tree-connector-width': '8px',
                              } as React.CSSProperties}
                            >
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Trash"
                                    style={{ marginLeft: `${(node.depth + 1) * 12}px` }}
                                    onClick={onTrashOpen}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        onTrashOpen();
                                      }
                                    }}
                                    className={cn(
                                      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
                                      "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                      "transition-colors duration-150"
                                    )}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span className="text-xs">.trash</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground">
                                      {getFolderTrashCount(node.id)}
                                    </span>
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-48">
                                  <ContextMenuItem onClick={onTrashOpen}>
                                    <FolderOpen className="w-3.5 h-3.5 mr-2" />
                                    View Trash
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    onClick={() => onEmptyTrash(node.id)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Empty Permanently
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return renderFolderNode(folderNode);
              })}

              {/* Root sessions (not in any folder) */}
              {renderSessionsWithSplits(rootSessions, {
                folderId: null,
                depth: 0,
              })}
            </>
          )}
      </div>

      {/* Footer - hide when collapsed */}
      {!collapsed && (
        <div className="px-3 py-1.5 border-t border-border space-y-1">
          {/* Schedules button */}
          {onSchedulesOpen && (
            <button
              onClick={onSchedulesOpen}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                "text-xs text-muted-foreground hover:text-foreground",
                "hover:bg-muted/50 transition-colors"
              )}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Schedules</span>
              {activeScheduleCount > 0 && (
                <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {activeScheduleCount}
                </span>
              )}
            </button>
          )}
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
