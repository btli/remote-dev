"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Briefcase,
  GitBranch,
  GitPullRequest,
  CircleDot,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";
import type { RepoStats } from "@/lib/project-tree-session-utils";

export interface ProjectRowProps {
  project: ProjectNode;
  depth: number;
  isActive: boolean;
  isEditing?: boolean;
  editValue?: string;
  collapsed: boolean;
  sessionCount: number;
  ownStats: RepoStats | null;
  hasCustomPrefs: boolean;
  hasActiveSecrets: boolean;
  hasLinkedRepo: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  onStartEdit?: () => void;
  onSaveEdit?: (value: string) => void;
  onCancelEdit?: () => void;
  children?: ReactNode;
  // Drag handlers (Phase E3). All optional — row participates in drag only
  // when props are supplied by the parent. Styling for drop indicators lives
  // in the caller.
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  // Drop indicator styling (Phase E5). When non-null, renders either a
  // before/after bar above/below the row or overrides the row background/border
  // for nest.
  dropIndicator?: "before" | "after" | "nest" | null;
}

export function ProjectRow({
  project,
  depth,
  isActive,
  isEditing = false,
  editValue,
  collapsed,
  sessionCount,
  ownStats,
  hasLinkedRepo,
  onSelect,
  onToggleCollapse,
  onOpenPreferences,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  children,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dropIndicator = null,
}: ProjectRowProps) {
  const isExpanded = !collapsed;

  const [local, setLocal] = useState(editValue ?? project.name);
  const committedRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset input value when editing session starts
      setLocal(editValue ?? project.name);
      committedRef.current = false;
    }
  }, [isEditing, editValue, project.name]);

  const commit = (value: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== project.name) onSaveEdit?.(trimmed);
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
          aria-label={project.name}
          draggable={draggable ?? false}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
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
            aria-label="Toggle project"
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

          {/* Briefcase icon with optional GitBranch overlay */}
          <div className="relative shrink-0">
            <Briefcase className="w-3.5 h-3.5 text-primary" />
            {hasLinkedRepo && (
              <GitBranch className="absolute -bottom-1 -right-1 h-2 w-2 text-primary" />
            )}
          </div>

          {/* Name */}
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
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEdit?.();
              }}
              className="truncate text-sm flex-1"
            >
              {project.name}
            </span>
          )}

          {/* Right-side badges */}
          {ownStats && (
            <div className="flex items-center gap-1 shrink-0">
              {ownStats.prCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-primary">
                  <GitPullRequest className="w-2.5 h-2.5" />
                  {ownStats.prCount}
                </span>
              )}
              {ownStats.issueCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-chart-2">
                  <CircleDot className="w-2.5 h-2.5" />
                  {ownStats.issueCount}
                </span>
              )}
              {ownStats.hasChanges && (
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
              )}
            </div>
          )}

          {/* Session count */}
          {sessionCount > 0 && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {sessionCount}
            </span>
          )}

          {/* Gear button */}
          {onOpenPreferences !== undefined && (
            <button
              type="button"
              aria-label="Project preferences"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPreferences();
              }}
              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition shrink-0"
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
