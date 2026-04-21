"use client";

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
  hasUnread: boolean;
  agentStatus: AgentActivityStatus | null;
  scheduleCount: number;
  onClick: () => void;
  onClose: () => void;
  onStartEdit: () => void;
}

export function SessionRow({
  session,
  depth,
  isActive,
  isEditing,
  hasUnread,
  agentStatus,
  scheduleCount,
  onClick,
  onClose,
  onStartEdit,
}: SessionRowProps) {
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
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      className={cn(
        "group relative flex items-center gap-2 px-2 py-1.5 rounded-md",
        "transition-all duration-200",
        isActive
          ? "bg-primary/20 border border-border"
          : "hover:bg-accent/50 border border-transparent",
        isAgentAlertState && "ring-2 ring-yellow-400/70 animate-pulse"
      )}
    >
      {/* Status icon */}
      {renderIcon()}

      {/* Session name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
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
