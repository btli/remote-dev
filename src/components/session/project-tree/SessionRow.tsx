"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal, Sparkles, GitBranch, MessageCircle, Pin, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { getSessionIconColor } from "./sessionIconColor";

export interface SessionRowProps {
  session: TerminalSession;
  depth: number;
  isActive: boolean;
  isEditing: boolean;
  editValue?: string;
  hasUnread: boolean;
  agentStatus: AgentActivityStatus | null;
  scheduleCount: number;
  onClick: () => void;
  onClose: () => void;
  onStartEdit: () => void;
  onSaveEdit?: (value: string) => void;
  onCancelEdit?: () => void;
  // Drag handlers (Phase E2). All optional — row participates in drag only when
  // these props are supplied by the parent. Opacity / drop-indicator styling is
  // owned by the caller.
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  // Drop indicator styling (Phase E5). When non-null, renders either a
  // before/after bar or overrides the row background/border for nest.
  dropIndicator?: "before" | "after" | "nest" | null;
}

export function SessionRow({
  session,
  depth,
  isActive,
  isEditing,
  editValue,
  hasUnread,
  agentStatus,
  scheduleCount,
  onClick,
  onClose,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dropIndicator = null,
}: SessionRowProps) {
  const [local, setLocal] = useState(editValue ?? session.name);
  const committedRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset input value when editing starts
      setLocal(editValue ?? session.name);
      committedRef.current = false;
    }
  }, [isEditing, editValue, session.name]);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== session.name) onSaveEdit?.(trimmed);
    else onCancelEdit?.();
  };
  const iconColor = getSessionIconColor(
    session,
    isActive,
    () => agentStatus ?? "idle"
  );

  const isAgentAlertState =
    !isActive &&
    agentStatus != null &&
    ["waiting", "error"].includes(agentStatus);

  function renderIcon() {
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
  }

  return (
    <div
      role="button"
      tabIndex={isEditing ? -1 : 0}
      aria-label={session.name}
      draggable={draggable ?? false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      className={cn(
        "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
        "transition-all duration-200",
        isActive
          ? "bg-primary/20 border border-border"
          : "hover:bg-accent/50 border border-transparent",
        isAgentAlertState && "ring-2 ring-yellow-400/70 animate-pulse",
        dropIndicator === "nest" && "bg-primary/20 border border-primary/30"
      )}
    >
      {dropIndicator === "before" && (
        <div className="pointer-events-none absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
      {dropIndicator === "after" && (
        <div className="pointer-events-none absolute -bottom-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
      {/* Status icon */}
      {renderIcon()}

      {/* Session name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isEditing ? (
            <input
              autoFocus
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(local);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  committedRef.current = true;
                  onCancelEdit?.();
                }
              }}
              onBlur={() => commit(local)}
              onClick={(e) => e.stopPropagation()}
              className="block w-full bg-input border border-primary/50 rounded px-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className={cn(
                "block truncate text-sm",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              )}
            >
              {session.name}
            </span>
          )}
          {/* Unread notification dot */}
          {hasUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          )}
        </div>
      </div>

      {/* Schedule count indicator */}
      {scheduleCount > 0 && (
        <span className="flex items-center gap-0.5 text-[9px] text-primary shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {scheduleCount}
        </span>
      )}

      {/* Pin indicator */}
      {session.pinned && !isEditing && (
        <Pin className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />
      )}

      {/* Close button */}
      {!isEditing && (
        <button
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "p-0.5 rounded opacity-0 group-hover:opacity-100",
            "hover:bg-accent transition-all duration-150",
            "text-muted-foreground hover:text-destructive"
          )}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
