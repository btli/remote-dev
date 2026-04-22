"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GitPullRequest,
  CircleDot,
  Plus,
  Settings,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNode } from "@/contexts/ProjectTreeContext";
import type { RepoStats } from "@/lib/project-tree-session-utils";

export interface GroupRowProps {
  group: GroupNode;
  depth: number;
  isActive: boolean;
  isEditing?: boolean;
  editValue?: string;
  sessionCount: number;
  rolledStats: RepoStats | null;
  hasCustomPrefs: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  onStartEdit?: () => void;
  onSaveEdit?: (value: string) => void;
  onCancelEdit?: () => void;
  onCreateSubgroup?: () => void;
  onCreateProject?: () => void;
  children?: ReactNode;
  // Drag handlers (Phase E3). All optional — surface used by parent to wire
  // project-drop targets. Full drag source wiring lands in Phase E4.
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  // Touch handlers (Phase F1). Optional — populated on mobile by the
  // `useTreeTouchDrag` hook in the sidebar to power long-press drag.
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  // Parent group id, rendered as a data-* attribute so the touch-drag resolver
  // (which uses `document.elementFromPoint`) can recover it without needing a
  // separate lookup table.
  parentGroupId?: string | null;
  // Drop indicator styling (Phase E5). When non-null, renders either a
  // before/after bar above/below the row or overrides the row background/border
  // for nest.
  dropIndicator?: "before" | "after" | "nest" | null;
}

export function GroupRow({
  group,
  depth,
  isActive,
  isEditing = false,
  editValue,
  sessionCount,
  rolledStats,
  onSelect,
  onToggleCollapse,
  onOpenPreferences,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onCreateSubgroup,
  onCreateProject,
  children,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  parentGroupId,
  dropIndicator = null,
}: GroupRowProps) {
  const isExpanded = !group.collapsed;

  const [local, setLocal] = useState(editValue ?? group.name);
  const committedRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset input value when editing session starts
      setLocal(editValue ?? group.name);
      committedRef.current = false;
    }
  }, [isEditing, editValue, group.name]);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== group.name) onSaveEdit?.(trimmed);
    else onCancelEdit?.();
  };

  return (
    <div className="relative space-y-0.5">
      {dropIndicator === "before" && (
        <div className="pointer-events-none absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
      {dropIndicator === "after" && (
        <div className="pointer-events-none absolute -bottom-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />
      )}
      <div
        className="group"
        data-active={isActive ? "true" : undefined}
      >
        <div
          role="button"
          tabIndex={isEditing ? -1 : 0}
          aria-label={group.name}
          data-node-type="group"
          data-node-id={group.id}
          data-node-parent-id={parentGroupId ?? ""}
          draggable={draggable ?? false}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect();
            }
          }}
          style={{ paddingLeft: depth * 12 + "px" }}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md",
            "hover:bg-accent/50 transition-all duration-150",
            isActive && "bg-accent/50",
            dropIndicator === "nest" && "bg-primary/20 border border-primary/30"
          )}
        >
          {/* Chevron toggle */}
          <button
            type="button"
            aria-label="Toggle group"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>

          {/* Folder icon */}
          {group.collapsed ? (
            <Folder className="w-3.5 h-3.5 shrink-0 text-primary" />
          ) : (
            <FolderOpen
              className={cn(
                "w-3.5 h-3.5 shrink-0 text-primary",
                isActive && "fill-primary"
              )}
            />
          )}

          {/* Name + inline changes dot, tightly adjacent. Wrapped in a
              flex-1 container so the dot hugs the name instead of floating
              at the far right of an expanded name span. */}
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
              className="flex-1 bg-input border border-primary/50 rounded px-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <div className="flex-1 min-w-0 flex items-center gap-1">
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onStartEdit?.();
                }}
                className="text-sm truncate"
              >
                {group.name}
              </span>
              {rolledStats?.hasChanges && (
                <span
                  data-testid="row-stat-changes"
                  aria-label="Has uncommitted changes"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400 animate-pulse"
                />
              )}
            </div>
          )}

          {/* Right-side stat cluster: four fixed-width slots aligned across rows.
              Empty slots still reserve width so numbers line up vertically. */}
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            <span
              data-testid="row-stat-pr"
              className="flex items-center gap-0.5 justify-end text-[9px] text-primary min-w-[24px]"
            >
              {rolledStats && rolledStats.prCount > 0 ? (
                <>
                  <GitPullRequest className="w-2.5 h-2.5" />
                  {rolledStats.prCount}
                </>
              ) : null}
            </span>
            <span
              data-testid="row-stat-issue"
              className="flex items-center gap-0.5 justify-end text-[9px] text-chart-2 min-w-[24px]"
            >
              {rolledStats && rolledStats.issueCount > 0 ? (
                <>
                  <CircleDot className="w-2.5 h-2.5" />
                  {rolledStats.issueCount}
                </>
              ) : null}
            </span>
            <span
              data-testid="row-stat-sessions"
              className="flex items-center gap-0.5 justify-end text-[9px] text-muted-foreground min-w-[24px]"
            >
              {sessionCount > 0 ? (
                <>
                  <Terminal className="w-2.5 h-2.5" />
                  {sessionCount}
                </>
              ) : null}
            </span>
          </div>

          {/* Hover-only action buttons. `hidden group-hover:flex` keeps them
              out of the layout when not hovered, so the stat cluster above
              stays right-anchored at a consistent X position across all rows. */}
          {onCreateSubgroup !== undefined && (
            <button
              type="button"
              aria-label="New subgroup"
              onClick={(e) => {
                e.stopPropagation();
                onCreateSubgroup();
              }}
              className="hidden group-hover:flex items-center p-1 text-muted-foreground hover:text-foreground transition shrink-0"
            >
              <FolderPlus className="h-3 w-3" />
            </button>
          )}
          {onCreateProject !== undefined && (
            <button
              type="button"
              aria-label="New project"
              onClick={(e) => {
                e.stopPropagation();
                onCreateProject();
              }}
              className="hidden group-hover:flex items-center p-1 text-muted-foreground hover:text-foreground transition shrink-0"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}

          {/* Gear button */}
          {onOpenPreferences !== undefined && (
            <button
              type="button"
              aria-label="Group preferences"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPreferences();
              }}
              className="hidden group-hover:flex items-center p-1 text-muted-foreground hover:text-foreground transition shrink-0"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sub-tree */}
      {isExpanded && children}
    </div>
  );
}
