"use client";

/**
 * BeadsDependencyTree - Simple recursive tree view of issue dependencies.
 *
 * Shows blocking (dependencies) and blocked-by (dependents) relationships
 * as an indented, collapsible list. Each node is clickable to navigate
 * to the linked issue detail.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type {
  BeadsIssue,
} from "@/types/beads";
import {
  PRIORITY_COLORS,
  STATUS_COLORS,
  shortenId,
} from "./beads-constants";

interface DependencyNodeProps {
  issueId: string;
  allIssues: BeadsIssue[];
  onNavigateToIssue: (issueId: string) => void;
  direction: "blocking" | "dependent";
  depth: number;
  visited: Set<string>;
}

function DependencyNode({
  issueId,
  allIssues,
  onNavigateToIssue,
  direction,
  depth,
  visited,
}: DependencyNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const issue = allIssues.find((i) => i.id === issueId);

  // Prevent infinite loops in cyclic graphs
  if (visited.has(issueId)) {
    return (
      <div
        className="flex items-center gap-1.5 pl-2 py-0.5 text-[11px] text-muted-foreground/50 italic"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="font-mono text-[10px]">
          {shortenId(issueId)}
        </span>
        <span>(circular)</span>
      </div>
    );
  }

  if (!issue) {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground/50"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="font-mono text-[10px]">
          {shortenId(issueId)}
        </span>
        <span>(not found)</span>
      </div>
    );
  }

  const priorityDot = PRIORITY_COLORS[issue.priority] ?? "bg-gray-500";
  const statusColor = STATUS_COLORS[issue.status] ?? "text-muted-foreground";
  const shortId = shortenId(issue.id);

  // Get child dependencies for this node
  const childIds =
    direction === "blocking"
      ? issue.dependencies.map((d) => d.dependsOnId)
      : issue.dependents.map((d) => d.issueId);

  const hasChildren = childIds.length > 0;
  const nextVisited = new Set(visited);
  nextVisited.add(issueId);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 rounded-sm hover:bg-accent/30 transition-colors"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Priority dot */}
        <span
          className={cn("w-1.5 h-1.5 rounded-full shrink-0", priorityDot)}
        />

        {/* Clickable issue info */}
        <button
          onClick={() => onNavigateToIssue(issue.id)}
          className="flex items-center gap-1.5 min-w-0 text-left hover:underline"
        >
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {shortId}
          </span>
          <span className="text-[11px] text-foreground truncate">
            {issue.title}
          </span>
        </button>

        {/* Status */}
        <span className={cn("text-[10px] shrink-0 ml-auto", statusColor)}>
          {issue.status.replace("_", " ")}
        </span>
      </div>

      {/* Children */}
      {expanded &&
        hasChildren &&
        childIds.map((childId) => (
          <DependencyNode
            key={childId}
            issueId={childId}
            allIssues={allIssues}
            onNavigateToIssue={onNavigateToIssue}
            direction={direction}
            depth={depth + 1}
            visited={nextVisited}
          />
        ))}
    </div>
  );
}

interface BeadsDependencyTreeProps {
  issue: BeadsIssue;
  allIssues: BeadsIssue[];
  onNavigateToIssue: (issueId: string) => void;
}

export function BeadsDependencyTree({
  issue,
  allIssues,
  onNavigateToIssue,
}: BeadsDependencyTreeProps) {
  const blockingIds = issue.dependencies.map((d) => d.dependsOnId);
  const dependentIds = issue.dependents.map((d) => d.issueId);
  const rootVisited = new Set([issue.id]);

  return (
    <div className="space-y-2">
      {/* Blocking (this issue depends on) */}
      {blockingIds.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            <ArrowUp className="w-3 h-3" />
            Blocked by ({blockingIds.length})
          </div>
          {blockingIds.map((depId) => (
            <DependencyNode
              key={depId}
              issueId={depId}
              allIssues={allIssues}
              onNavigateToIssue={onNavigateToIssue}
              direction="blocking"
              depth={0}
              visited={rootVisited}
            />
          ))}
        </div>
      )}

      {/* Dependents (issues that depend on this one) */}
      {dependentIds.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            <ArrowDown className="w-3 h-3" />
            Blocking ({dependentIds.length})
          </div>
          {dependentIds.map((depId) => (
            <DependencyNode
              key={depId}
              issueId={depId}
              allIssues={allIssues}
              onNavigateToIssue={onNavigateToIssue}
              direction="dependent"
              depth={0}
              visited={rootVisited}
            />
          ))}
        </div>
      )}
    </div>
  );
}
