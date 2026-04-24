"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal, GitBranch, Pin, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { getSessionIconColor } from "./sessionIconColor";
import { SessionMetadataBar } from "../SessionMetadataBar";
import { TerminalTypeClientRegistry } from "@/lib/terminal-plugins/client";
import {
  initializeClientPlugins,
  isClientPluginsInitialized,
} from "@/lib/terminal-plugins/init-client";

// Lazily initialize the client plugin registry so the registry lookup below
// always sees the built-in plugins. This is idempotent and safe to call
// during SSR — the init only mutates an in-memory Map and does not touch
// browser APIs. See `src/lib/terminal-plugins/README.md` for the migration
// plan; once A2 lands, a root client provider can own initialization and
// this module-level call can go away.
if (!isClientPluginsInitialized()) {
  initializeClientPlugins();
}

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
  // Swipe-to-close (Phase F2). When supplied by the parent, the row renders
  // inside a relative wrapper that exposes a reveal-button on the right when
  // `swipeRevealed` is true. `dragTranslateStyle` drives the transient
  // translate during an active drag.
  dragTranslateStyle?: React.CSSProperties;
  swipeRevealed?: boolean;
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  // Whether the outer sidebar is rendered in collapsed mode. Passed through to
  // SessionMetadataBar, which hides itself when true. Defaults to false since
  // the new project tree does not yet expose a collapsed mode.
  isCollapsed?: boolean;
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
  dragTranslateStyle,
  swipeRevealed = false,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  isCollapsed = false,
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

  const plugin = TerminalTypeClientRegistry.get(session.terminalType);
  // Worktree branch state wins over plugin icon since it reflects session
  // state (a shell on a worktree branch should still show GitBranch), not
  // terminal type.
  const Icon = session.worktreeBranch
    ? GitBranch
    : (plugin?.icon ?? Terminal);
  // Plugin-derived title override. Plugins may return null to fall back to
  // the stored session name. Existing built-in plugins don't implement this
  // yet; it's here so future plugins can derive titles from typeMetadata
  // (e.g. "Issues — my-repo") without relying on session.name being set.
  const derivedTitle = plugin?.deriveTitle?.(session) ?? null;
  const displayTitle = derivedTitle ?? session.name;

  function renderIcon() {
    return <Icon className={cn("w-3.5 h-3.5 shrink-0", iconColor)} />;
  }

  const mergedInnerStyle: React.CSSProperties = {
    marginLeft: depth > 0 ? `${depth * 12}px` : undefined,
    ...(dragTranslateStyle ?? {}),
  };

  return (
    <div className="relative">
      {swipeRevealed && scheduleCount === 0 && (
        <button
          type="button"
          aria-label="Close session"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          // z-20 so the revealed button sits above the row even after the row
          // snaps back to translateX(0) on touchend. Without this the row
          // covers the button visually AND intercepts taps, making it look
          // like "click does nothing".
          className="absolute right-0 top-0 bottom-0 w-[72px] z-20 bg-destructive text-destructive-foreground flex items-center justify-center rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <div
        role="button"
        tabIndex={isEditing ? -1 : 0}
        aria-label={displayTitle}
        draggable={draggable ?? false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onClick}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        style={mergedInnerStyle}
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

      {/* Session name + metadata bar (stacked column) */}
      <div className="flex-1 min-w-0 flex flex-col">
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
              className="block w-full bg-input border border-primary/50 rounded px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className={cn(
                "block truncate text-xs",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              )}
            >
              {displayTitle}
            </span>
          )}
          {/* Unread notification dot */}
          {hasUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          )}
        </div>
        {!isEditing && (
          <SessionMetadataBar session={session} isCollapsed={isCollapsed} />
        )}
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
              "hidden group-hover:flex items-center p-0.5 rounded",
              "hover:bg-accent transition-all duration-150",
              "text-muted-foreground hover:text-destructive"
            )}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
