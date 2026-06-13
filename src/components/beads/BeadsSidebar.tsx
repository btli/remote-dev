"use client";

/**
 * BeadsSidebar - Right sidebar with tabbed Beads issue tracking and Schedules.
 *
 * Two tabs: "Beads" shows issues grouped by status, "Schedules" shows
 * session-scoped schedule management. Resizable, collapsible panel.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useBeadsContext } from "@/contexts/BeadsContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Circle,
  GitBranch,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  ArrowLeft,
  Clock,
  CircleOff,
  ServerOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hasActiveBlockers,
  type BeadsDependency,
  type BeadsIssue,
} from "@/types/beads";
import { BeadsIssueDetail } from "./BeadsIssueDetail";
import {
  PRIORITY_COLORS,
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_COLORS,
  STATUS_COLORS,
  DEP_CHIP_COLOR,
  shortenId,
} from "./beads-constants";
import { CheckSquare } from "lucide-react";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { SchedulesPanel } from "@/components/schedule/SchedulesPanel";

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

type SidebarTab = "beads" | "schedules";

function getStoredTab(): SidebarTab {
  if (typeof window === "undefined") return "beads";
  const stored = localStorage.getItem("beads-sidebar-tab");
  return stored === "schedules" ? "schedules" : "beads";
}

function setStoredTab(val: SidebarTab) {
  localStorage.setItem("beads-sidebar-tab", val);
}

/**
 * Child completion progress for an epic ({closed, total}).
 *
 * Dedupes by child id — the same pair can be linked via both 'child-of' and
 * 'parent-child' rows (bd renamed the type in 1.0.5), and the dep loader keys
 * its dedupe on type, so both rows survive.
 *
 * A child link whose target is NOT in `issueMap` counts as closed: the
 * beads-service epic-children augmentation always loads non-closed children
 * (`status != 'closed' OR closed_at >= cutoff OR issue_type = 'epic'`), so a
 * not-loaded child can only be a retention-pruned closed issue.
 */
export function computeEpicProgress(
  children: BeadsDependency[],
  issueMap: Map<string, BeadsIssue>
): { closed: number; total: number } {
  const childIds = new Set(children.map((child) => child.issueId));
  let closed = 0;
  for (const childId of childIds) {
    const target = issueMap.get(childId);
    // Not loaded ⇒ retention-pruned closed (non-closed children always load).
    if (!target || target.status === "closed") closed++;
  }
  return { closed, total: childIds.size };
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
  /** Child completion progress for epic rows ({closed, total}). */
  epicProgress?: { closed: number; total: number };
}

function BeadsIssueRow({ issue, onSelect, epicProgress }: BeadsIssueRowProps) {
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
                  <span className={cn("flex items-center gap-0.5 text-[10px]", DEP_CHIP_COLOR)}>
                    <GitBranch className="w-2.5 h-2.5" />
                    {depCount}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Blocked by {issue.dependencies.length} · blocks {issue.dependents.length}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Epic child progress */}
            {epicProgress && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded">
                <Layers className="w-2.5 h-2.5" />
                {epicProgress.closed}/{epicProgress.total}
              </span>
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

interface BeadsSidebarProps {
  /** Session ID to pre-select in CreateScheduleModal (from context menu trigger) */
  scheduleTargetSessionId?: string | null;
  /** Called after CreateScheduleModal opens to reset the trigger */
  onScheduleTargetConsumed?: () => void;
}

export function BeadsSidebar({
  scheduleTargetSessionId,
  onScheduleTargetConsumed,
}: BeadsSidebarProps) {
  const {
    issues, stats, loading, error, initialized, unavailable, projectPath, refreshIssues,
    beadsSidebarCollapsed: dbCollapsed,
    beadsSidebarWidth: dbWidth,
    beadsSectionExpanded: dbSectionExpanded,
    userSettingsLoaded,
  } = useBeadsContext();
  const { updateUserSettings } = usePreferencesContext();
  const { schedules } = useScheduleContext();

  // Sidebar state — seed from DB defaults so SSR and first client render match,
  // then hydrate from localStorage in a mount-only effect below. Reading
  // localStorage in the initializer causes a hydration mismatch when the
  // stored value diverges from the DB default.
  const [collapsed, setCollapsed] = useState(dbCollapsed);
  const [width, setWidth] = useState(dbWidth);

  // Selected issue id for detail view (declared early so switchTab can reference it).
  // Storing the id (not an object snapshot) keeps the detail pane live across refreshes.
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // Active tab state — seeded with SSR-safe default, hydrated from localStorage on mount.
  const [activeTab, setActiveTab] = useState<SidebarTab>("beads");

  // Hydrate sidebar state from localStorage after mount. Uses plain setters so
  // we don't echo a cross-tab event for our own hydration.
  useEffect(() => {
    if (localStorage.getItem("beads-sidebar-collapsed") !== null) {
      setCollapsed(getStoredCollapsed());
    }
    if (localStorage.getItem("beads-sidebar-width") !== null) {
      setWidth(getStoredWidth());
    }
    if (localStorage.getItem("beads-sidebar-tab") !== null) {
      setActiveTab(getStoredTab());
    }
  }, []);

  // Propagate DB → local state for edits that arrive AFTER the initial
  // userSettings load (e.g. Settings-page edits). The load transition itself
  // is skipped — that first dbCollapsed change is just the default → real-DB
  // flip and would clobber the localStorage value the hydration effect applied.
  const collapsedSyncReady = useRef(false);
  useEffect(() => {
    if (!userSettingsLoaded) return;
    if (!collapsedSyncReady.current) {
      collapsedSyncReady.current = true;
      return;
    }
    setCollapsed(dbCollapsed);
    setStoredCollapsed(dbCollapsed);
  }, [userSettingsLoaded, dbCollapsed]);

  const widthSyncReady = useRef(false);
  useEffect(() => {
    if (!userSettingsLoaded) return;
    if (!widthSyncReady.current) {
      widthSyncReady.current = true;
      return;
    }
    setWidth(dbWidth);
    setStoredWidth(dbWidth);
  }, [userSettingsLoaded, dbWidth]);

  const switchTab = useCallback((tab: SidebarTab) => {
    setActiveTab(tab);
    setStoredTab(tab);
    // Clear issue detail when switching away from beads
    if (tab !== "beads") setSelectedIssueId(null);
  }, []);

  // Auto-switch to schedules tab when a schedule target arrives
  useEffect(() => {
    if (scheduleTargetSessionId) {
      switchTab("schedules");
    }
  }, [scheduleTargetSessionId, switchTab]);

  // Section expand state — seed from DB settings
  const [readyExpanded, setReadyExpanded] = useState(dbSectionExpanded.ready);
  const [inProgressExpanded, setInProgressExpanded] = useState(dbSectionExpanded.inProgress);
  const [openExpanded, setOpenExpanded] = useState(dbSectionExpanded.open);
  const [closedExpanded, setClosedExpanded] = useState(dbSectionExpanded.closed);

  // Sync section expand state when changed via Settings page
  useEffect(() => {
    setReadyExpanded(dbSectionExpanded.ready);
    setInProgressExpanded(dbSectionExpanded.inProgress);
    setOpenExpanded(dbSectionExpanded.open);
    setClosedExpanded(dbSectionExpanded.closed);
  }, [dbSectionExpanded]);

  // Persist section expand changes to DB (current values read via refs to avoid stale closures)
  const sectionExpandRef = useRef({ readyExpanded, inProgressExpanded, openExpanded, closedExpanded });
  useEffect(() => {
    sectionExpandRef.current = { readyExpanded, inProgressExpanded, openExpanded, closedExpanded };
  });

  const persistSectionExpanded = useCallback(
    (key: "ready" | "inProgress" | "open" | "closed", value: boolean) => {
      const cur = sectionExpandRef.current;
      updateUserSettings({
        beadsSectionExpanded: {
          ready: key === "ready" ? value : cur.readyExpanded,
          inProgress: key === "inProgress" ? value : cur.inProgressExpanded,
          open: key === "open" ? value : cur.openExpanded,
          closed: key === "closed" ? value : cur.closedExpanded,
        },
      });
    },
    [updateUserSettings]
  );

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
          !hasActiveBlockers(issue)
        ) {
          // Ready = open with no still-active blocking dependencies
          ready.push(issue);
        } else {
          // Open with active blockers, stored 'blocked' status, or deferred
          open.push(issue);
        }
      }

      // Most recently closed first; issues without a closedAt sort last.
      const closedSorted = [...closed].sort((a, b) => {
        if (a.closedAt && b.closedAt) return b.closedAt.getTime() - a.closedAt.getTime();
        if (a.closedAt) return -1;
        if (b.closedAt) return 1;
        return 0;
      });

      return {
        readyIssues: ready,
        inProgressIssues: inProgress,
        openIssues: open,
        closedIssues: closedSorted,
      };
    }, [issues]);

  // All non-closed issues (Ready + In Progress + Open buckets)
  const openCount = stats
    ? (stats.total - stats.closed)
    : (readyIssues.length + openIssues.length + inProgressIssues.length);

  // O(1) lookup map for navigating to issues by ID
  const issueMap = useMemo(() => new Map(issues.map(i => [i.id, i])), [issues]);

  // Derive the selected issue from the live list so the detail pane never
  // shows a stale snapshot; if the issue is pruned, this returns null and the
  // sidebar falls back to the list view.
  const selectedIssue = useMemo(
    () => (selectedIssueId ? issueMap.get(selectedIssueId) ?? null : null),
    [selectedIssueId, issueMap]
  );

  const handleSelectIssue = useCallback((issue: BeadsIssue) => {
    setSelectedIssueId(issue.id);
  }, []);

  // Child completion progress for epic rows
  const epicProgressById = useMemo(() => {
    const map = new Map<string, { closed: number; total: number }>();
    for (const issue of issues) {
      if (issue.issueType !== "epic") continue;
      const progress = computeEpicProgress(issue.children, issueMap);
      if (progress.total === 0) continue;
      map.set(issue.id, progress);
    }
    return map;
  }, [issues, issueMap]);

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
        updateUserSettings({ beadsSidebarWidth: latestWidthRef.current });
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [width, updateUserSettings]
  );

  // Toggle collapse — persist to localStorage + DB
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setStoredCollapsed(next);
    setCollapsed(next);
    updateUserSettings({ beadsSidebarCollapsed: next });
  }, [collapsed, updateUserSettings]);

  // Navigate to a different issue from the detail view (e.g. clicking a dependency)
  const handleNavigateToIssue = useCallback(
    (issueId: string) => {
      if (issueMap.has(issueId)) {
        setSelectedIssueId(issueId);
      }
    },
    [issueMap]
  );

  // Build tooltip content for beads icon hover
  const beadsTooltipContent = useMemo(() => {
    if (!projectPath) return "No project selected";
    if (!initialized) return "Beads not set up";
    if (issues.length === 0) return "No issues";
    const parts: string[] = [];
    if (inProgressIssues.length > 0) parts.push(`${inProgressIssues.length} in progress`);
    if (readyIssues.length > 0) parts.push(`${readyIssues.length} ready`);
    if (openIssues.length > 0) parts.push(`${openIssues.length} open`);
    if (closedIssues.length > 0) parts.push(`${closedIssues.length} closed`);
    return parts.length > 0 ? parts.join(", ") : "No issues";
  }, [projectPath, initialized, issues.length, inProgressIssues.length, readyIssues.length, openIssues.length, closedIssues.length]);

  // Build tooltip content for schedules icon hover
  const schedulesTooltipContent = useMemo(() => {
    if (schedules.length === 0) return "No schedules";
    const enabled = schedules.filter(s => s.enabled).length;
    const disabled = schedules.length - enabled;
    const parts: string[] = [`${enabled} active`];
    if (disabled > 0) parts.push(`${disabled} paused`);
    return parts.join(", ");
  }, [schedules]);

  // Collapsed state - vertical icon strip with both icons and expand button
  if (collapsed) {
    return (
      <div className="w-12 shrink-0 h-full flex flex-col items-center py-2 gap-1 border-l border-border bg-card/30">
        {/* Expand button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Expand sidebar</TooltipContent>
        </Tooltip>

        <Separator className="w-6" />

        {/* Beads icon — toggle tab only, don't expand */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => switchTab("beads")}
              className={cn(
                "relative p-2 rounded-md transition-colors",
                activeTab === "beads"
                  ? "text-foreground bg-accent/50"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {initialized ? (
                <Circle className="w-4 h-4" />
              ) : (
                <CircleOff className="w-4 h-4" />
              )}
              {initialized && openCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {openCount > 9 ? "9+" : openCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <div className="font-medium">Beads</div>
            <div className="text-muted-foreground">{beadsTooltipContent}</div>
          </TooltipContent>
        </Tooltip>

        {/* Schedules icon — toggle tab only, don't expand */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => switchTab("schedules")}
              className={cn(
                "relative p-2 rounded-md transition-colors",
                activeTab === "schedules"
                  ? "text-foreground bg-accent/50"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              <Clock className="w-4 h-4" />
              {schedules.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {schedules.length > 9 ? "9+" : schedules.length}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <div className="font-medium">Schedules</div>
            <div className="text-muted-foreground">{schedulesTooltipContent}</div>
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
      <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border">
        {selectedIssue && activeTab === "beads" ? (
          <button
            onClick={() => setSelectedIssueId(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          /* Tab toggle */
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
            <button
              onClick={() => switchTab("beads")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                activeTab === "beads"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Beads
            </button>
            <button
              onClick={() => switchTab("schedules")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                activeTab === "schedules"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Schedules
            </button>
          </div>
        )}

        <span className="flex-1" />

        {activeTab === "beads" && !selectedIssue && openCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {openCount}
          </span>
        )}
        {activeTab === "beads" && !selectedIssue && (
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

      {/* Content — Beads or Schedules */}
      {activeTab === "schedules" ? (
        <SchedulesPanel
          scheduleTargetSessionId={scheduleTargetSessionId}
          onScheduleTargetConsumed={onScheduleTargetConsumed}
        />
      ) : selectedIssue ? (
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
                <p className="text-xs font-medium text-destructive">
                  Failed to load issues
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {error}
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
            ) : !initialized && !loading ? (
              /* Beads not set up */
              <div className="flex flex-col items-center justify-center px-4 py-8 gap-2">
                <CircleOff className="w-5 h-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground text-center">
                  Beads is not set up for this project
                </p>
                <p className="text-[11px] text-muted-foreground text-center">
                  Run{" "}
                  <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">
                    bd init
                  </code>{" "}
                  to get started
                </p>
              </div>
            ) : initialized && unavailable ? (
              /* bd returned no data for this project */
              <div className="flex flex-col items-center justify-center px-4 py-8 gap-2">
                <ServerOff className="w-5 h-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground text-center">
                  Couldn&apos;t load beads
                </p>
                <p className="text-[11px] text-muted-foreground text-center">
                  bd didn&apos;t return data for this project. Make sure bd is
                  installed and the project&apos;s beads are initialized, then
                  retry.
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
                    onToggle={() => { setReadyExpanded(!readyExpanded); persistSectionExpanded("ready", !readyExpanded); }}
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
                            onSelect={handleSelectIssue}
                            epicProgress={epicProgressById.get(issue.id)}
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
                    onToggle={() => {
                      setInProgressExpanded(!inProgressExpanded);
                      persistSectionExpanded("inProgress", !inProgressExpanded);
                    }}
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
                            onSelect={handleSelectIssue}
                            epicProgress={epicProgressById.get(issue.id)}
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
                    onToggle={() => { setOpenExpanded(!openExpanded); persistSectionExpanded("open", !openExpanded); }}
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
                            onSelect={handleSelectIssue}
                            epicProgress={epicProgressById.get(issue.id)}
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
                    onToggle={() => { setClosedExpanded(!closedExpanded); persistSectionExpanded("closed", !closedExpanded); }}
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
                            onSelect={handleSelectIssue}
                            epicProgress={epicProgressById.get(issue.id)}
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
    </div>
  );
}
