"use client";

import { useState, useRef, useEffect } from "react";
import {
  X, Plus, Pause, Terminal, Settings,
  Folder, FolderOpen, MoreHorizontal, Pencil, Trash2, Sparkles, GitBranch
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

export interface SessionFolder {
  id: string;
  parentId: string | null;
  name: string;
  collapsed: boolean;
}

interface FolderNode extends SessionFolder {
  children: FolderNode[];
  depth: number;
}

interface SidebarProps {
  sessions: TerminalSession[];
  folders: SessionFolder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
  activeSessionId: string | null;
  activeFolderId: string | null;
  folderHasPreferences: (folderId: string) => boolean;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onFolderCreate: (name: string, parentId?: string | null) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onFolderClick: (folderId: string) => void;
  onFolderSettings: (folderId: string, folderName: string) => void;
  onFolderNewSession: (folderId: string) => void;
  onFolderAdvancedSession: (folderId: string) => void;
  onFolderMove: (folderId: string, newParentId: string | null) => void;
}

export function Sidebar({
  sessions,
  folders,
  sessionFolders,
  activeSessionId,
  activeFolderId,
  folderHasPreferences,
  onSessionClick,
  onSessionClose,
  onSessionRename,
  onSessionMove,
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
  onFolderMove,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<"session" | "folder" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingSubfolderId, setCreatingSubfolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Sessions not in any folder
  const rootSessions = activeSessions.filter(
    (s) => !sessionFolders[s.id]
  );

  // Build folder tree from flat list
  const buildFolderTree = (folders: SessionFolder[]): FolderNode[] => {
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

    // Third pass: recalculate depths for nested children
    const setDepths = (nodes: FolderNode[], depth: number) => {
      nodes.forEach((node) => {
        node.depth = depth;
        setDepths(node.children, depth + 1);
      });
    };
    setDepths(rootFolders, 0);

    return rootFolders;
  };

  const folderTree = buildFolderTree(folders);

  // Check if a folder is a descendant of another
  const isDescendantOf = (folderId: string, ancestorId: string): boolean => {
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    let current = folderMap.get(folderId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = folderMap.get(current.parentId);
    }
    return false;
  };

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
  };

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
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null);
    }
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
  };

  const renderSession = (session: TerminalSession, depth = 0) => {
    const isActive = session.id === activeSessionId;
    const isSuspended = session.status === "suspended";
    const isEditing = editingId === session.id;
    const currentFolderId = sessionFolders[session.id];

    return (
      <div
        key={session.id}
        draggable={!isEditing}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onDragEnd={handleDragEnd}
        className={!isEditing ? "cursor-grab active:cursor-grabbing" : ""}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => !isEditing && onSessionClick(session.id)}
              style={{ marginLeft: depth > 0 ? `${(depth + 1) * 12}px` : undefined }}
              className={cn(
                "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
                "transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-violet-500/20 via-purple-500/15 to-blue-500/10 border border-white/10"
                  : "hover:bg-white/5 border border-transparent"
              )}
            >
            {/* Status indicator */}
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isSuspended
                  ? "bg-amber-400"
                  : isActive
                  ? "bg-green-400 animate-pulse"
                  : "bg-slate-600"
              )}
            />

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
                  className="w-full bg-slate-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
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
                      isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                    )}
                    title="Double-click to rename"
                  >
                    {session.name}
                  </span>
                  {/* Git branch indicator */}
                  {session.worktreeBranch && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-400/80 truncate">
                      <GitBranch className="w-2.5 h-2.5" />
                      {session.worktreeBranch}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Suspended indicator */}
            {isSuspended && !isEditing && (
              <Pause className="w-3 h-3 text-amber-400 shrink-0" />
            )}

            {/* Close button */}
            {!isEditing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSessionClose(session.id);
                }}
                className={cn(
                  "p-0.5 rounded opacity-0 group-hover:opacity-100",
                  "hover:bg-white/10 transition-all duration-150",
                  "text-slate-500 hover:text-red-400"
                )}
              >
                <X className="w-3 h-3" />
              </button>
            )}
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
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onSessionClose(session.id)}
            className="text-red-400 focus:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Close Session
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  };

  return (
    <div className="w-52 h-full flex flex-col bg-slate-900/50 backdrop-blur-md border-r border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-medium text-white">Sessions</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              onClick={() => setCreatingFolder(true)}
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
            >
              <Folder className="w-3.5 h-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  onClick={(e) => {
                    // If not opening dropdown, do quick session
                    if (!e.defaultPrevented) {
                      onQuickNewSession();
                    }
                  }}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
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
          </div>
        </div>

        {/* Session List */}
        <div
          className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5"
          onDragOver={(e) => handleDragOver(e, null)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, null)}
        >
          {activeSessions.length === 0 && folders.length === 0 && !creatingFolder ? (
            <div className="text-center py-8 px-2">
              <Terminal className="w-6 h-6 mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-500 mb-2">No sessions</p>
              <div className="flex flex-col gap-1 items-center">
                <Button
                  onClick={onQuickNewSession}
                  variant="ghost"
                  size="sm"
                  className="text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  New Session
                </Button>
                <button
                  onClick={onNewSession}
                  className="text-[10px] text-slate-500 hover:text-slate-400 transition-colors"
                >
                  Advanced options...
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* New folder input (at root level) */}
              {creatingFolder && !creatingSubfolderId && (
                <div className="flex items-center gap-1 px-2 py-1">
                  <Folder className="w-3.5 h-3.5 text-violet-400 shrink-0" />
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
                    className="flex-1 bg-slate-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              )}

              {/* Recursive folder rendering */}
              {folderTree.map((folderNode) => {
                const renderFolderNode = (node: FolderNode): React.ReactNode => {
                  const folderSessions = activeSessions.filter(
                    (s) => sessionFolders[s.id] === node.id
                  );
                  const isEditingFolder = editingId === node.id && editingType === "folder";
                  const isDragOver = dragOverFolderId === node.id;
                  const isActive = activeFolderId === node.id;
                  const hasPrefs = folderHasPreferences(node.id);
                  const isBeingDragged = draggingFolderId === node.id;
                  const canDropHere = !draggingFolderId ||
                    (draggingFolderId !== node.id && !isDescendantOf(node.id, draggingFolderId));

                  // Count total items (sessions + subfolders)
                  const totalItems = folderSessions.length + node.children.length;

                  return (
                    <div key={node.id} className="space-y-0.5">
                      <div
                        draggable={!isEditingFolder}
                        onDragStart={(e) => handleFolderDragStart(e, node.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, node.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, node.id)}
                        style={{ marginLeft: node.depth > 0 ? `${node.depth * 12}px` : undefined }}
                        className={cn(
                          "group flex items-center gap-1.5 px-2 py-1 rounded-md",
                          !isEditingFolder && "cursor-grab active:cursor-grabbing",
                          "hover:bg-white/5 transition-all duration-150",
                          isDragOver && canDropHere && "bg-violet-500/20 border border-violet-500/30",
                          isActive && "bg-violet-500/10",
                          isBeingDragged && "opacity-50"
                        )}
                        onClick={() => {
                          onFolderClick(node.id);
                          onFolderToggle(node.id);
                        }}
                      >
                        {node.collapsed && !isActive ? (
                          <Folder
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              "text-violet-400"
                            )}
                          />
                        ) : (
                          <FolderOpen
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-violet-300 fill-violet-400"
                                : "text-violet-400"
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
                            className="flex-1 bg-slate-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                          />
                        ) : (
                          <span
                            className="flex-1 text-xs text-slate-300 truncate"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(node.id, "folder", node.name, e);
                            }}
                            title="Double-click to rename"
                          >
                            {node.name}
                          </span>
                        )}

                        <span className="text-[10px] text-slate-500">
                          {totalItems}
                        </span>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-slate-500"
                            >
                              <MoreHorizontal className="w-3 h-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                onFolderNewSession(node.id);
                              }}
                            >
                              <Terminal className="w-3 h-3 mr-2" />
                              New Session
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                onFolderAdvancedSession(node.id);
                              }}
                            >
                              <Sparkles className="w-3 h-3 mr-2" />
                              Advanced...
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleStartSubfolderCreate(node.id);
                              }}
                            >
                              <Folder className="w-3 h-3 mr-2" />
                              New Subfolder
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                onFolderSettings(node.id, node.name);
                              }}
                            >
                              <Settings className="w-3 h-3 mr-2" />
                              Preferences
                              {hasPrefs && (
                                <span className="ml-auto text-[10px] text-violet-400">Custom</span>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleStartEdit(node.id, "folder", node.name, e);
                              }}
                            >
                              <Pencil className="w-3 h-3 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            {node.parentId && (
                              <DropdownMenuItem
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  onFolderMove(node.id, null);
                                }}
                              >
                                <FolderOpen className="w-3 h-3 mr-2" />
                                Move to Root
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                onFolderDelete(node.id);
                              }}
                              className="text-red-400 focus:text-red-400"
                            >
                              <Trash2 className="w-3 h-3 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Subfolder creation input */}
                      {creatingFolder && creatingSubfolderId === node.id && !node.collapsed && (
                        <div
                          className="flex items-center gap-1 px-2 py-1"
                          style={{ marginLeft: `${(node.depth + 1) * 12}px` }}
                        >
                          <Folder className="w-3.5 h-3.5 text-violet-400 shrink-0" />
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
                            className="flex-1 bg-slate-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                          />
                        </div>
                      )}

                      {/* Child folders and sessions when not collapsed */}
                      {!node.collapsed && (
                        <>
                          {node.children.map((child) => renderFolderNode(child))}
                          {folderSessions.map((session) => renderSession(session, node.depth + 1))}
                        </>
                      )}
                    </div>
                  );
                };

                return renderFolderNode(folderNode);
              })}

              {/* Root sessions (not in any folder) */}
              {rootSessions.map((session) => renderSession(session))}
            </>
          )}
        </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>New session</span>
          <kbd className="px-1 py-0.5 bg-slate-800 rounded">⌘↵</kbd>
        </div>
      </div>
    </div>
  );
}
