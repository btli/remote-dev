"use client";

import type { ReactNode } from "react";
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

interface ProjectRowProps {
  project: ProjectNode;
  depth: number;
  isActive: boolean;
  collapsed: boolean;
  sessionCount: number;
  ownStats: RepoStats | null;
  hasCustomPrefs: boolean;
  hasActiveSecrets: boolean;
  hasLinkedRepo: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  children?: ReactNode;
}

export function ProjectRow({
  project,
  depth,
  isActive,
  collapsed,
  sessionCount,
  ownStats,
  hasLinkedRepo,
  onSelect,
  onToggleCollapse,
  onOpenPreferences,
  children,
}: ProjectRowProps) {
  const isExpanded = !collapsed;

  return (
    <div className="space-y-0.5">
      <div
        className="group"
        data-active={isActive ? "true" : undefined}
      >
        <div
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
          <span
            className="flex-1 text-sm truncate cursor-pointer"
            onClick={onSelect}
          >
            {project.name}
          </span>

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
