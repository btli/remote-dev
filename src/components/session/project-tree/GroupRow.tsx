"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GitPullRequest,
  CircleDot,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNode } from "@/contexts/ProjectTreeContext";
import type { RepoStats } from "@/lib/project-tree-session-utils";

interface GroupRowProps {
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
  children?: ReactNode;
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
  children,
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
    <div className="space-y-0.5">
      <div
        className="group"
        data-active={isActive ? "true" : undefined}
      >
        <div
          role="button"
          tabIndex={isEditing ? -1 : 0}
          aria-label={group.name}
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
            isActive && "bg-accent/50"
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
              className="flex-1 text-sm truncate"
            >
              {group.name}
            </span>
          )}

          {/* Right-side badges */}
          {rolledStats && (
            <div className="flex items-center gap-1 shrink-0">
              {rolledStats.prCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-primary">
                  <GitPullRequest className="w-2.5 h-2.5" />
                  {rolledStats.prCount}
                </span>
              )}
              {rolledStats.issueCount > 0 && (
                <span className="flex items-center gap-0.5 text-[9px] text-chart-2">
                  <CircleDot className="w-2.5 h-2.5" />
                  {rolledStats.issueCount}
                </span>
              )}
              {rolledStats.hasChanges && (
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
              aria-label="Group preferences"
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
