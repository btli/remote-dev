"use client";

/**
 * TaskSidebar - Right sidebar for project task tracking, GitHub issues,
 * and schedule management.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTaskContext } from "@/contexts/TaskContext";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { useSessionContext } from "@/contexts/SessionContext";
import {
  useRepositoryIssues,
  type GitHubIssueDTO,
} from "@/contexts/GitHubIssuesContext";
import {
  ClipboardList,
  Plus,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  Bot,
  CircleDot,
  CircleCheck,
  CircleX,
  Circle,
  Loader2,
  Trash2,
  Calendar,
  Link2,
  User,
  Lock,
  FileText,
  Clock,
  Repeat,
  Play,
} from "lucide-react";
import { IssueDetailModal } from "@/components/github/IssueDetailModal";
import { getIssueIcon } from "@/components/github/issue-icons";
import { CreateScheduleModal } from "@/components/schedule/CreateScheduleModal";
import { EditScheduleModal } from "@/components/schedule/EditScheduleModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ProjectTask,
  TaskStatus,
  UpdateTaskInput,
} from "@/types/task";
import { PRIORITY_CONFIG } from "@/types/task";
import type { SessionScheduleWithSession } from "@/types/schedule";
import { TaskEditor } from "./TaskEditor";

// --- Sidebar state persistence (mirrors left sidebar pattern) ---

const MIN_WIDTH = 240;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("task-sidebar-collapsed") !== "false";
}

function getStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = localStorage.getItem("task-sidebar-width");
  return stored ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored, 10))) : DEFAULT_WIDTH;
}

function setStoredCollapsed(val: boolean) {
  localStorage.setItem("task-sidebar-collapsed", String(val));
  window.dispatchEvent(new CustomEvent("task-sidebar-collapsed-change"));
}

function setStoredWidth(val: number) {
  localStorage.setItem("task-sidebar-width", String(val));
  window.dispatchEvent(new CustomEvent("task-sidebar-width-change"));
}

// --- Inline task quick-add ---

interface QuickAddProps {
  onAdd: (title: string) => void;
}

function QuickAdd({ onAdd }: QuickAddProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
    }
  };

  return (
    <div className="flex gap-1 px-2 py-1.5">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Add a task..."
        className="h-7 text-xs bg-card border-border"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleSubmit}
        disabled={!value.trim()}
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// --- Task item ---

const STATUS_ICONS: Record<TaskStatus, React.ElementType> = {
  open: Circle,
  in_progress: CircleDot,
  done: CircleCheck,
  cancelled: CircleX,
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "text-muted-foreground",
  in_progress: "text-chart-2",
  done: "text-green-500",
  cancelled: "text-muted-foreground/50",
};

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
  cancelled: "open",
};

function isCompleted(task: ProjectTask): boolean {
  return task.status === "done" || task.status === "cancelled";
}

function countByCompletion(tasks: ProjectTask[]): { active: number; completed: number } {
  let completed = 0;
  for (const task of tasks) {
    if (isCompleted(task)) completed++;
  }
  return { active: tasks.length - completed, completed };
}

interface TaskItemProps {
  task: ProjectTask;
  isExpanded: boolean;
  allTasks: ProjectTask[];
  onExpand: () => void;
  onUpdate: (id: string, input: UpdateTaskInput) => void;
  onDelete: (id: string) => Promise<boolean>;
}

function TaskItem({ task, isExpanded, allTasks, onExpand, onUpdate, onDelete }: TaskItemProps) {
  const StatusIcon = STATUS_ICONS[task.status];
  const priorityConfig = PRIORITY_CONFIG[task.priority];

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;
  const isBlocked = task.blockedBy.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group px-2 py-1.5 rounded-md transition-all duration-150",
          "hover:bg-accent/50",
          task.status === "done" && "opacity-60",
          isExpanded && "bg-accent/30"
        )}
      >
        {/* Main row */}
        <div className="flex items-start gap-1.5">
          {/* Status toggle */}
          <button
            onClick={() =>
              onUpdate(task.id, { status: NEXT_STATUS[task.status] })
            }
            className="mt-0.5 shrink-0"
          >
            <StatusIcon
              className={cn("w-3.5 h-3.5", STATUS_COLORS[task.status])}
            />
          </button>

          {/* Title + meta */}
          <div className="flex-1 min-w-0">
            <button
              onClick={onExpand}
              className="w-full text-left"
            >
              <span
                className={cn(
                  "text-xs text-foreground line-clamp-2",
                  task.status === "done" && "line-through"
                )}
              >
                {task.title}
              </span>
            </button>

            {/* Meta row */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {/* Priority badge */}
              <span
                className="text-[10px] px-1 py-0.5 rounded"
                style={{
                  backgroundColor: `#${priorityConfig.color}20`,
                  color: `#${priorityConfig.color}`,
                }}
              >
                {priorityConfig.label}
              </span>

              {/* Labels */}
              {task.labels.slice(0, 2).map((label) => (
                <span
                  key={label.name}
                  className="text-[10px] px-1 py-0.5 rounded"
                  style={{
                    backgroundColor: `#${label.color}20`,
                    color: `#${label.color}`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {task.labels.length > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{task.labels.length - 2}
                </span>
              )}

              {/* Subtask count */}
              {totalSubtasks > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {completedSubtasks}/{totalSubtasks}
                </span>
              )}

              {/* Due date */}
              {task.dueDate && (
                <span
                  className={cn(
                    "text-[10px] flex items-center gap-0.5",
                    new Date(task.dueDate) < new Date() && task.status !== "done"
                      ? "text-red-400"
                      : "text-muted-foreground"
                  )}
                >
                  <Calendar className="w-2.5 h-2.5" />
                  {new Date(task.dueDate).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}

              {/* Blocked indicator */}
              {isBlocked && (
                <Tooltip>
                  <TooltipTrigger>
                    <Lock className="w-2.5 h-2.5 text-orange-400" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Blocked by {task.blockedBy.length} task(s)
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Source badge */}
              {task.source === "agent" ? (
                <Bot className="w-2.5 h-2.5 text-primary/60" />
              ) : (
                <User className="w-2.5 h-2.5 text-muted-foreground/40" />
              )}

              {/* GitHub link */}
              {task.githubIssueUrl && (
                <a
                  href={task.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Link2 className="w-2.5 h-2.5" />
                </a>
              )}

              {/* Instructions indicator */}
              {task.instructions && (
                <Tooltip>
                  <TooltipTrigger>
                    <FileText className="w-2.5 h-2.5 text-primary/60" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Has instructions</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Delete button (on hover) */}
          <button
            onClick={() => onDelete(task.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
          >
            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {isExpanded && (
        <div className="px-1 pb-1">
          <TaskEditor
            task={task}
            allTasks={allTasks}
            onUpdate={onUpdate}
            onClose={onExpand}
          />
        </div>
      )}
    </div>
  );
}

// --- Clear tasks confirmation dialog ---

interface ClearTasksDialogProps {
  open: boolean;
  onClose: () => void;
  onClear: (completedOnly: boolean) => Promise<void>;
  totalCount: number;
  completedCount: number;
}

function ClearTasksDialog({
  open,
  onClose,
  onClear,
  totalCount,
  completedCount,
}: ClearTasksDialogProps) {
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = async (completedOnly: boolean) => {
    setIsClearing(true);
    try {
      await onClear(completedOnly);
    } finally {
      setIsClearing(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">
            Clear Tasks
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            This action cannot be undone. Choose which tasks to remove:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {completedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={isClearing}
              onClick={() => handleClear(true)}
            >
              Clear completed ({completedCount})
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="w-full text-xs"
            disabled={isClearing}
            onClick={() => handleClear(false)}
          >
            Clear all ({totalCount})
          </Button>
          <AlertDialogCancel
            className="w-full text-xs"
            disabled={isClearing}
          >
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Section header ---

interface SectionHeaderProps {
  icon: React.ElementType;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  expanded,
  onToggle,
  action,
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
        <Icon className="w-3.5 h-3.5" />
        <span className="font-medium">{title}</span>
        {count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </button>
      {action}
    </div>
  );
}

// --- Clear button for section headers ---

interface ClearButtonProps {
  label: string;
  onClick: () => void;
}

function ClearButton({ label, onClick }: ClearButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

// --- GitHub issue/PR link item ---

interface GitHubIssueLinkProps {
  issue: GitHubIssueDTO;
  onLink: () => void;
  onSelect: () => void;
}

function GitHubIssueLink({ issue, onLink, onSelect }: GitHubIssueLinkProps) {
  return (
    <div className="flex items-start gap-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors group">
      {getIssueIcon(issue, "w-3.5 h-3.5 mt-0.5 shrink-0")}
      <div className="flex-1 min-w-0">
        <button
          onClick={onSelect}
          className="w-full text-left text-xs text-foreground hover:underline line-clamp-1"
        >
          <span className="text-primary mr-1">#{issue.number}</span>
          {issue.title}
        </button>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onLink}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
          >
            <Link2 className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Create task from issue</TooltipContent>
      </Tooltip>
    </div>
  );
}

// --- Schedule item ---

function formatNextRun(date: Date | null): string {
  if (!date) return "Not scheduled";
  const d = new Date(date);
  const now = new Date();
  const diff = d.getTime() - now.getTime();

  if (diff < 0) return "Overdue";
  if (diff < 60000) return "< 1 min";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ScheduleItemProps {
  schedule: SessionScheduleWithSession;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  isRunning: boolean;
}

function getScheduleStatusColor(schedule: SessionScheduleWithSession, isCompleted: boolean): string {
  if (!schedule.enabled) return "text-muted-foreground";
  if (schedule.status === "failed") return "text-red-400";
  if (isCompleted) return "text-blue-400";
  return "text-primary";
}

function ScheduleStatusLabel({ schedule, isCompleted }: { schedule: SessionScheduleWithSession; isCompleted: boolean }) {
  if (isCompleted) {
    return <span className="text-[10px] text-blue-400">Completed</span>;
  }
  if (schedule.status === "failed") {
    return <span className="text-[10px] text-red-400">Failed</span>;
  }
  if (schedule.status === "paused" || !schedule.enabled) {
    return <span className="text-[10px] text-muted-foreground">Paused</span>;
  }
  return (
    <span className="text-[10px] text-muted-foreground">
      Next: {formatNextRun(schedule.nextRunAt)}
    </span>
  );
}

function ScheduleItem({ schedule, onEdit, onDelete, onToggle, onRunNow, isRunning }: ScheduleItemProps) {
  const isOneTime = schedule.scheduleType === "one-time";
  const isCompleted = isOneTime && schedule.status === "completed";
  const statusColor = getScheduleStatusColor(schedule, isCompleted);
  const TypeIcon = isOneTime ? Calendar : Repeat;

  return (
    <div className="group px-2 py-1.5 rounded-md transition-all duration-150 hover:bg-accent/50">
      <div className="flex items-start gap-1.5">
        {/* Type icon */}
        <TypeIcon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", statusColor)} />

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <button onClick={onEdit} className="w-full text-left">
            <span className={cn(
              "text-xs text-foreground line-clamp-1",
              !schedule.enabled && "opacity-50"
            )}>
              {schedule.name}
            </span>
          </button>

          <div className="flex items-center gap-1.5 mt-0.5">
            <ScheduleStatusLabel schedule={schedule} isCompleted={isCompleted} />

            {/* Session name */}
            <span className="text-[10px] text-muted-foreground/50 truncate">
              {schedule.session?.name}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          {/* Enable/disable toggle — always visible */}
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
            className="scale-[0.55]"
          />

          {/* Run now — hover only */}
          <button
            onClick={onRunNow}
            disabled={isRunning}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-green-400"
          >
            {isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
          </button>

          {/* Delete — hover only */}
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Delete schedule confirmation dialog ---

interface DeleteScheduleDialogProps {
  open: boolean;
  scheduleName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function DeleteScheduleDialog({ open, scheduleName, onConfirm, onClose }: DeleteScheduleDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">Delete Schedule</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            Are you sure you want to delete{" "}
            <span className="text-foreground font-medium">&quot;{scheduleName}&quot;</span>?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            size="sm"
            className="w-full text-xs"
            disabled={isDeleting}
            onClick={handleConfirm}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <AlertDialogCancel className="w-full text-xs" disabled={isDeleting}>
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Main TaskSidebar ---

interface TaskSidebarProps {
  githubRepoId: string | null;
  onViewIssue?: (issueNumber: number) => void;
  onViewPR?: (prNumber: number) => void;
  /** Session ID to pre-select in CreateScheduleModal (from context menu trigger) */
  scheduleTargetSessionId?: string | null;
  /** Called after CreateScheduleModal opens to reset the trigger */
  onScheduleTargetConsumed?: () => void;
}

export function TaskSidebar({
  githubRepoId,
  onViewIssue,
  onViewPR,
  scheduleTargetSessionId,
  onScheduleTargetConsumed,
}: TaskSidebarProps) {
  const { tasks, loading, createTask, updateTask, deleteTask, clearTasks, activeFolderId } =
    useTaskContext();
  const { schedules, toggleEnabled, deleteSchedule, executeNow } = useScheduleContext();
  const { sessions } = useSessionContext();
  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== "closed"),
    [sessions]
  );

  // Sidebar state — lazy-initialize from localStorage (SSR-safe: functions only run on client)
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [width, setWidth] = useState(getStoredWidth);

  // Section expand state
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const [schedulesExpanded, setSchedulesExpanded] = useState(false);

  // Schedule modal/dialog state
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [createScheduleSessionId, setCreateScheduleSessionId] = useState<string | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  // Open CreateScheduleModal when triggered from session context menu
  useEffect(() => {
    if (scheduleTargetSessionId) {
      setCreateScheduleSessionId(scheduleTargetSessionId);
      setSchedulesExpanded(true);
      setCreateScheduleOpen(true);
      onScheduleTargetConsumed?.();
    }
  }, [scheduleTargetSessionId, onScheduleTargetConsumed]);

  // Expanded task editor state — at most one task expanded at a time
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // GitHub issues from existing context
  const { issues: githubIssues, isLoading: issuesLoading, refresh: refreshIssues } =
    useRepositoryIssues(githubRepoId);

  // Issue detail modal state
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssueDTO | null>(null);

  // Fetch GitHub issues when section is expanded
  useEffect(() => {
    if (issuesExpanded && githubRepoId) {
      refreshIssues();
    }
  }, [issuesExpanded, githubRepoId, refreshIssues]);

  // Listen for collapse state changes (cross-tab sync)
  useEffect(() => {
    const onCollapsedChange = () => setCollapsed(getStoredCollapsed());
    const onWidthChange = () => setWidth(getStoredWidth());
    const onToggle = () => {
      const next = !getStoredCollapsed();
      setStoredCollapsed(next);
      setCollapsed(next);
    };

    window.addEventListener("task-sidebar-collapsed-change", onCollapsedChange);
    window.addEventListener("task-sidebar-width-change", onWidthChange);
    window.addEventListener("task-sidebar-toggle", onToggle);

    return () => {
      window.removeEventListener(
        "task-sidebar-collapsed-change",
        onCollapsedChange
      );
      window.removeEventListener("task-sidebar-width-change", onWidthChange);
      window.removeEventListener("task-sidebar-toggle", onToggle);
    };
  }, []);

  // Keyboard shortcut: Cmd+.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        const next = !getStoredCollapsed();
        setStoredCollapsed(next);
        setCollapsed(next);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
        // Dragging left = increasing width (since sidebar is on the right)
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

  // Unified task list — all tasks, no split by source
  const { active: openTaskCount, completed: completedCount } = useMemo(
    () => countByCompletion(tasks),
    [tasks]
  );

  // Clear tasks dialog state
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const handleClearTasks = useCallback(
    async (completedOnly: boolean) => {
      await clearTasks(undefined, {
        completedOnly,
      });
    },
    [clearTasks]
  );

  // Handlers
  const handleAddTask = useCallback(
    (title: string) => {
      createTask({ title, folderId: activeFolderId });
    },
    [createTask, activeFolderId]
  );

  const handleLinkIssue = useCallback(
    (issue: GitHubIssueDTO) => {
      createTask({
        title: issue.title,
        folderId: activeFolderId,
        githubIssueUrl: issue.htmlUrl,
        description: `Linked from GitHub #${issue.number}`,
      });
    },
    [createTask, activeFolderId]
  );

  // Schedule handlers
  const handleRunNow = useCallback(
    async (scheduleId: string) => {
      setRunningScheduleId(scheduleId);
      try {
        await executeNow(scheduleId);
      } catch (err) {
        console.error("Failed to execute schedule:", err);
      } finally {
        setRunningScheduleId(null);
      }
    },
    [executeNow]
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
              <ClipboardList className="w-4 h-4" />
              {openTaskCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {openTaskCount > 9 ? "9+" : openTaskCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Tasks ({openTaskCount} open)
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 h-full flex flex-col bg-card/50 backdrop-blur-md border-l border-border relative"
      style={{ width }}
    >
      {/* Resize handle (left edge) */}
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <ClipboardList className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">
          Tasks
        </span>
        {openTaskCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {openTaskCount}
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Tasks and GitHub — require active folder */}
          {!activeFolderId ? (
            <div className="flex items-center justify-center px-4 py-8">
              <p className="text-xs text-muted-foreground text-center">
                Select a project folder to view tasks
              </p>
            </div>
          ) : (
            <>
            {/* Unified Tasks Section */}
            <div>
              <SectionHeader
                icon={ClipboardList}
                title="Tasks"
                count={openTaskCount}
                expanded={tasksExpanded}
                onToggle={() => setTasksExpanded(!tasksExpanded)}
                action={
                  tasks.length > 0 ? (
                    <ClearButton label="Clear tasks" onClick={() => setClearDialogOpen(true)} />
                  ) : undefined
                }
              />
              {tasksExpanded && (
                <>
                  <QuickAdd onAdd={handleAddTask} />
                  <div className="space-y-0.5 px-1">
                    {tasks.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground px-3 py-2">
                        No tasks yet. Add one above.
                      </p>
                    ) : (
                      tasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          isExpanded={expandedTaskId === task.id}
                          allTasks={tasks}
                          onExpand={() =>
                            setExpandedTaskId(
                              expandedTaskId === task.id ? null : task.id
                            )
                          }
                          onUpdate={updateTask}
                          onDelete={deleteTask}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Separator */}
            <div className="border-t border-border my-1" />

            {/* GitHub Issues Section */}
            <div>
              <SectionHeader
                icon={CircleDot}
                title="GitHub"
                count={githubIssues.length}
                expanded={issuesExpanded}
                onToggle={() => setIssuesExpanded(!issuesExpanded)}
              />
              {issuesExpanded && (
                <div className="space-y-0.5 px-1">
                  {!githubRepoId ? (
                    <p className="text-[11px] text-muted-foreground px-3 py-2">
                      Link a GitHub repo to this folder to see issues.
                    </p>
                  ) : issuesLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Loading issues...</span>
                    </div>
                  ) : githubIssues.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-3 py-2">
                      No issues found.
                    </p>
                  ) : (
                    githubIssues.map((issue) => (
                      <GitHubIssueLink
                        key={issue.number}
                        issue={issue}
                        onLink={() => handleLinkIssue(issue)}
                        onSelect={() => {
                          if (issue.isPullRequest && onViewPR) {
                            onViewPR(issue.number);
                          } else if (!issue.isPullRequest && onViewIssue) {
                            onViewIssue(issue.number);
                          } else {
                            setSelectedIssue(issue);
                          }
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </>
          )}

          {/* Separator */}
          <div className="border-t border-border my-1" />

          {/* Schedules Section — always visible (not folder-scoped) */}
          <div>
            <SectionHeader
              icon={Clock}
              title="Schedules"
              count={schedules.length}
              expanded={schedulesExpanded}
              onToggle={() => setSchedulesExpanded(!schedulesExpanded)}
              action={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setCreateScheduleOpen(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">New schedule</TooltipContent>
                </Tooltip>
              }
            />
            {schedulesExpanded && (
              <div className="space-y-0.5 px-1">
                {schedules.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-3 py-2">
                    No schedules. Click + to create one.
                  </p>
                ) : (
                  schedules.map((schedule) => (
                    <ScheduleItem
                      key={schedule.id}
                      schedule={schedule}
                      onEdit={() => setEditingScheduleId(schedule.id)}
                      onDelete={() => setDeleteTarget({ id: schedule.id, name: schedule.name })}
                      onToggle={(enabled) => toggleEnabled(schedule.id, enabled)}
                      onRunNow={() => handleRunNow(schedule.id)}
                      isRunning={runningScheduleId === schedule.id}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-card/50 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Issue/PR detail modal */}
      <IssueDetailModal
        open={selectedIssue !== null}
        onClose={() => setSelectedIssue(null)}
        issue={selectedIssue}
      />

      {/* Clear tasks confirmation dialog */}
      {clearDialogOpen && (
        <ClearTasksDialog
          open
          onClose={() => setClearDialogOpen(false)}
          onClear={handleClearTasks}
          totalCount={tasks.length}
          completedCount={completedCount}
        />
      )}

      {/* Create Schedule Modal */}
      <CreateScheduleModal
        open={createScheduleOpen}
        onClose={() => {
          setCreateScheduleOpen(false);
          setCreateScheduleSessionId(null);
        }}
        sessions={activeSessions}
        session={
          createScheduleSessionId
            ? activeSessions.find((s) => s.id === createScheduleSessionId) ?? null
            : undefined
        }
      />

      {/* Edit Schedule Modal */}
      {editingScheduleId && (
        <EditScheduleModal
          open
          onClose={() => setEditingScheduleId(null)}
          scheduleId={editingScheduleId}
        />
      )}

      {/* Delete Schedule Confirmation */}
      {deleteTarget && (
        <DeleteScheduleDialog
          open
          scheduleName={deleteTarget.name}
          onConfirm={() => deleteSchedule(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
