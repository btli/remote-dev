"use client";

import { useState, useRef, useEffect } from "react";
import {
  X, Plus, Pause, Terminal, ChevronRight, ChevronDown,
  Folder, FolderOpen, MoreHorizontal, Pencil, Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  name: string;
  collapsed: boolean;
}

interface SidebarProps {
  sessions: TerminalSession[];
  folders: SessionFolder[];
  sessionFolders: Record<string, string>; // sessionId -> folderId
  activeSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionMove: (sessionId: string, folderId: string | null) => void;
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onFolderCreate: (name: string) => void;
  onFolderRename: (folderId: string, newName: string) => void;
  onFolderDelete: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
}

export function Sidebar({
  sessions,
  folders,
  sessionFolders,
  activeSessionId,
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
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<"session" | "folder" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Sessions not in any folder
  const rootSessions = activeSessions.filter(
    (s) => !sessionFolders[s.id]
  );

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
      onFolderCreate(newFolderName.trim());
      setNewFolderName("");
      setCreatingFolder(false);
    }
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCreateFolder();
    } else if (e.key === "Escape") {
      setCreatingFolder(false);
      setNewFolderName("");
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.effectAllowed = "move";
    // Add a class to indicate dragging
    (e.target as HTMLElement).classList.add("opacity-50");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove("opacity-50");
    setDragOverFolderId(null);
  };

  const handleDragOver = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving to outside the current element
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const sessionId = e.dataTransfer.getData("text/plain");
    if (sessionId) {
      onSessionMove(sessionId, folderId);
    }
    setDragOverFolderId(null);
  };

  const renderSession = (session: TerminalSession, inFolder = false) => {
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
              className={cn(
                "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
                "transition-all duration-200",
                inFolder && "ml-4",
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
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(session.id, "session", session.name, e);
                  }}
                  className={cn(
                    "block truncate text-xs cursor-text hover:underline hover:decoration-dotted",
                    isActive ? "text-white" : "text-slate-400 group-hover:text-white"
                  )}
                  title="Click to rename"
                >
                  {session.name}
                </span>
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
    <TooltipProvider delayDuration={300}>
      <div className="w-52 h-full flex flex-col bg-slate-900/50 backdrop-blur-md border-r border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-medium text-white">Sessions</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setCreatingFolder(true)}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <Folder className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Folder</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onQuickNewSession}
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span>New Session</span>
                  <kbd className="px-1 py-0.5 text-[10px] bg-slate-700 rounded">⌘↵</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
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
              {/* New folder input */}
              {creatingFolder && (
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
                      } else {
                        handleCreateFolder();
                      }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-slate-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              )}

              {/* Folders */}
              {folders.map((folder) => {
                const folderSessions = activeSessions.filter(
                  (s) => sessionFolders[s.id] === folder.id
                );
                const isEditingFolder = editingId === folder.id && editingType === "folder";
                const isDragOver = dragOverFolderId === folder.id;

                return (
                  <div key={folder.id} className="space-y-0.5">
                    <div
                      onDragOver={(e) => handleDragOver(e, folder.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, folder.id)}
                      className={cn(
                        "group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer",
                        "hover:bg-white/5 transition-all duration-150",
                        isDragOver && "bg-violet-500/20 border border-violet-500/30"
                      )}
                      onClick={() => onFolderToggle(folder.id)}
                    >
                      {folder.collapsed ? (
                        <ChevronRight className="w-3 h-3 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-slate-500" />
                      )}
                      {folder.collapsed ? (
                        <Folder className="w-3.5 h-3.5 text-violet-400" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
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
                        <span className="flex-1 text-xs text-slate-300 truncate">
                          {folder.name}
                        </span>
                      )}

                      <span className="text-[10px] text-slate-500">
                        {folderSessions.length}
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
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              handleStartEdit(folder.id, "folder", folder.name, e);
                            }}
                          >
                            <Pencil className="w-3 h-3 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              onFolderDelete(folder.id);
                            }}
                            className="text-red-400 focus:text-red-400"
                          >
                            <Trash2 className="w-3 h-3 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Folder sessions */}
                    {!folder.collapsed && folderSessions.map((session) => renderSession(session, true))}
                  </div>
                );
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
    </TooltipProvider>
  );
}
