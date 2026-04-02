"use client";

/**
 * BeadsSidebar - Right sidebar for project-scoped beads issue tracking.
 *
 * Displays issues grouped by status (Ready, In Progress, Open, Closed)
 * with a resizable, collapsible panel. Issues are read-only in the UI;
 * mutations happen through the `bd` CLI or beads-mcp server.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useBeadsContext } from "@/contexts/BeadsContext";
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Circle,
  GitBranch,
  PanelRightClose,
  Loader2,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  BeadsIssue,
} from "@/types/beads";
import { BeadsIssueDetail } from "./BeadsIssueDetail";
import {
  PRIORITY_COLORS,
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_COLORS,
  STATUS_COLORS,
  shortenId,
} from "./beads-constants";
import { CheckSquare } from "lucide-react";

const MIN_WIDTH = 240;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 320;

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("beads-sidebar-collapsed") !== "false";
}

function getStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = localStorage.getItem("beads-sidebar-width");
  return stored
    ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored, 10)))
    : DEFAULT_WIDTH;
}

function setStoredCollapsed(val: boolean) {
  localStorage.setItem("beads-sidebar-collapsed", String(val));
  window.dispatchEvent(new CustomEvent("beads-sidebar-collapsed-change"));
}

function setStoredWidth(val: number) {
  localStorage.setItem("beads-sidebar-width", String(val));
  window.dispatchEvent(new CustomEvent("beads-sidebar-width-change"));
}

interface SectionHeaderProps {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
}: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 flex-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="font-medium">{title}</span>
        {count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

interface BeadsIssueRowProps {
  issue: BeadsIssue;
  onSelect: (issue: BeadsIssue) => void;
}

function BeadsIssueRow({ issue, onSelect }: BeadsIssueRowProps) {
  const TypeIcon = ISSUE_TYPE_ICONS[issue.issueType] ?? CheckSquare;
  const typeColor = ISSUE_TYPE_COLORS[issue.issueType] ?? "text-muted-foreground";
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? "bg-gray-500";
  const priorityLabel = `P${issue.priority}`;
  const statusColor = STATUS_COLORS[issue.status] ?? "text-muted-foreground";

  const depCount = issue.dependencies.length + issue.dependents.length;

  const shortId = shortenId(issue.id);

  return (
    <button
      onClick={() => onSelect(issue)}
      className={cn(
        "group w-full text-left px-2 py-1.5 rounded-md transition-all duration-150",
        "hover:bg-accent/50"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Priority dot */}
        <span
          className={cn(
            "mt-1.5 w-2 h-2 rounded-full shrink-0",
            priorityColor
          )}
        />

        {/* Type icon */}
        <TypeIcon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", typeColor)} />

        {/* Title and meta */}
        <div className="flex-1 min-w-0">
          <span className="text-xs text-foreground line-clamp-2">
            {issue.title}
          </span>

          {/* Meta row */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {/* Issue ID */}
            <span className="text-[10px] font-mono text-muted-foreground">
              {shortId}
            </span>

            {/* Priority label */}
            <span
              className={cn(
                "text-[10px] px-1 py-0.5 rounded font-medium",
                priorityColor,
                "text-white"
              )}
            >
              {priorityLabel}
            </span>

            {/* Status */}
            <span className={cn("text-[10px]", statusColor)}>
              {issue.status.replace("_", " ")}
            </span>

            {/* Dependency count */}
            {depCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[10px] text-orange-400">
                    <GitBranch className="w-2.5 h-2.5" />
                    {depCount}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {issue.dependencies.length} blocking, {issue.dependents.length} dependent
                </TooltipContent>
              </Tooltip>
            )}

            {/* Labels (first 2) */}
            {issue.labels.slice(0, 2).map((label) => (
              <span
                key={label}
                className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {label}
              </span>
            ))}
            {issue.labels.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{issue.labels.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export function BeadsSidebar() {
  const { issues, stats, loading, error, projectPath, refreshIssues } =
    useBeadsContext();

  // Sidebar state (lazy-init from localStorage, SSR-safe)
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [width, setWidth] = useState(getStoredWidth);

  // Section expand state
  const [readyExpanded, setReadyExpanded] = useState(true);
  const [inProgressExpanded, setInProgressExpanded] = useState(true);
  const [openExpanded, setOpenExpanded] = useState(true);
  const [closedExpanded, setClosedExpanded] = useState(false);

  // Selected issue for detail view
  const [selectedIssue, setSelectedIssue] = useState<BeadsIssue | null>(null);

  // Categorize issues
  const { readyIssues, inProgressIssues, openIssues, closedIssues } =
    useMemo(() => {
      const ready: BeadsIssue[] = [];
      const inProgress: BeadsIssue[] = [];
      const open: BeadsIssue[] = [];
      const closed: BeadsIssue[] = [];

      for (const issue of issues) {
        if (issue.status === "closed") {
          closed.push(issue);
        } else if (issue.status === "in_progress") {
          inProgress.push(issue);
        } else if (
          issue.status === "open" &&
          issue.dependencies.length === 0
        ) {
          // Ready = open with no blocking dependencies
          ready.push(issue);
        } else {
          // Open with blocking deps, or deferred
          open.push(issue);
        }
      }

      return {
        readyIssues: ready,
        inProgressIssues: inProgress,
        openIssues: open,
        closedIssues: closed,
      };
    }, [issues]);

  const openCount = stats?.open ?? readyIssues.length + openIssues.length;

  // O(1) lookup map for navigating to issues by ID
  const issueMap = useMemo(() => new Map(issues.map(i => [i.id, i])), [issues]);

  // Listen for collapse state changes (cross-tab sync)
  useEffect(() => {
    const onCollapsedChange = () => setCollapsed(getStoredCollapsed());
    const onWidthChange = () => setWidth(getStoredWidth());
    const onToggle = () => {
      const next = !getStoredCollapsed();
      setStoredCollapsed(next);
      setCollapsed(next);
    };

    window.addEventListener("beads-sidebar-collapsed-change", onCollapsedChange);
    window.addEventListener("beads-sidebar-width-change", onWidthChange);
    window.addEventListener("beads-sidebar-toggle", onToggle);

    return () => {
      window.removeEventListener("beads-sidebar-collapsed-change", onCollapsedChange);
      window.removeEventListener("beads-sidebar-width-change", onWidthChange);
      window.removeEventListener("beads-sidebar-toggle", onToggle);
    };
  }, []);

  // Resize handle
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidthRef = useRef(width);
  useEffect(() => {
    latestWidthRef.current = width;
  }, [width]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: width };

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = resizeRef.current.startX - e.clientX;
        const newWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, resizeRef.current.startWidth + delta)
        );
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        setStoredWidth(latestWidthRef.current);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [width]
  );

  // Toggle collapse
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setStoredCollapsed(next);
    setCollapsed(next);
  }, [collapsed]);

  // Navigate to a different issue from the detail view (e.g. clicking a dependency)
  const handleNavigateToIssue = useCallback(
    (issueId: string) => {
      const target = issueMap.get(issueId);
      if (target) {
        setSelectedIssue(target);
      }
    },
    [issueMap]
  );

  // Collapsed state - icon strip
  if (collapsed) {
    return (
      <div className="w-12 shrink-0 h-full flex flex-col items-center py-2 border-l border-border bg-card/30">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              className={cn(
                "relative p-2 rounded-md transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              <Circle className="w-4 h-4" />
              {openCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {openCount > 9 ? "9+" : openCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Beads ({openCount} open)
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 h-full flex flex-col bg-background/80 backdrop-blur-md border-l border-border/50 relative"
      style={{ width }}
    >
      {/* Resize handle (left edge) */}
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {selectedIssue ? (
          <button
            onClick={() => setSelectedIssue(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <Circle className="w-4 h-4 text-primary shrink-0" />
        )}
        <span className="text-xs font-semibold text-foreground flex-1">
          {selectedIssue ? "Issue Detail" : "Beads"}
        </span>
        {!selectedIssue && openCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {openCount}
          </span>
        )}
        {!selectedIssue && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => refreshIssues()}
                disabled={loading}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", loading && "animate-spin")}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Refresh issues</TooltipContent>
          </Tooltip>
        )}
        <button
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {selectedIssue ? (
        <BeadsIssueDetail
          issue={selectedIssue}
          allIssues={issues}
          projectPath={projectPath!}
          onNavigateToIssue={handleNavigateToIssue}
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1">
            {/* No project selected */}
            {!projectPath ? (
              <div className="flex items-center justify-center px-4 py-8">
                <p className="text-xs text-muted-foreground text-center">
                  Select a project folder to view issues
                </p>
              </div>
            ) : error ? (
              /* Error state */
              <div className="px-4 py-6 space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-medium">
                    Failed to load issues
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {error}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Dolt server may not be running. Start with{" "}
                  <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">
                    bd daemon start
                  </code>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs mt-2"
                  onClick={() => refreshIssues()}
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Retry
                </Button>
              </div>
            ) : issues.length === 0 && !loading ? (
              /* Empty state */
              <div className="flex items-center justify-center px-4 py-8">
                <p className="text-xs text-muted-foreground text-center">
                  No issues. Run{" "}
                  <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">
                    bd create
                  </code>{" "}
                  to get started.
                </p>
              </div>
            ) : (
              <>
                {/* Ready Section (open + unblocked) */}
                <div>
                  <SectionHeader
                    title="Ready"
                    count={readyIssues.length}
                    expanded={readyExpanded}
                    onToggle={() => setReadyExpanded(!readyExpanded)}
                  />
                  {readyExpanded && (
                    <div className="space-y-0.5 px-1">
                      {readyIssues.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground px-3 py-1">
                          No ready issues
                        </p>
                      ) : (
                        readyIssues.map((issue) => (
                          <BeadsIssueRow
                            key={issue.id}
                            issue={issue}
                            onSelect={setSelectedIssue}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>

                <Separator className="my-1" />

                {/* In Progress Section */}
                <div>
                  <SectionHeader
                    title="In Progress"
                    count={inProgressIssues.length}
                    expanded={inProgressExpanded}
                    onToggle={() =>
                      setInProgressExpanded(!inProgressExpanded)
                    }
                  />
                  {inProgressExpanded && (
                    <div className="space-y-0.5 px-1">
                      {inProgressIssues.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground px-3 py-1">
                          No issues in progress
                        </p>
                      ) : (
                        inProgressIssues.map((issue) => (
                          <BeadsIssueRow
                            key={issue.id}
                            issue={issue}
                            onSelect={setSelectedIssue}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>

                <Separator className="my-1" />

                {/* Open (blocked / deferred) Section */}
                <div>
                  <SectionHeader
                    title="Open"
                    count={openIssues.length}
                    expanded={openExpanded}
                    onToggle={() => setOpenExpanded(!openExpanded)}
                  />
                  {openExpanded && (
                    <div className="space-y-0.5 px-1">
                      {openIssues.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground px-3 py-1">
                          No blocked or deferred issues
                        </p>
                      ) : (
                        openIssues.map((issue) => (
                          <BeadsIssueRow
                            key={issue.id}
                            issue={issue}
                            onSelect={setSelectedIssue}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>

                <Separator className="my-1" />

                {/* Closed Section (collapsed by default) */}
                <div>
                  <SectionHeader
                    title="Closed"
                    count={closedIssues.length}
                    expanded={closedExpanded}
                    onToggle={() => setClosedExpanded(!closedExpanded)}
                  />
                  {closedExpanded && (
                    <div className="space-y-0.5 px-1">
                      {closedIssues.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground px-3 py-1">
                          No closed issues
                        </p>
                      ) : (
                        closedIssues.map((issue) => (
                          <BeadsIssueRow
                            key={issue.id}
                            issue={issue}
                            onSelect={setSelectedIssue}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Loading overlay */}
      {loading && issues.length > 0 && (
        <div className="absolute inset-0 bg-card/50 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
