"use client";

/**
 * TaskSidebar - Right sidebar for project task tracking
 *
 * Displays manual tasks, agent tasks, and GitHub issues
 * scoped to the active folder/project.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTaskContext } from "@/contexts/TaskContext";
import { useRepositoryIssues } from "@/contexts/GitHubIssuesContext";
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
  Check,
  Calendar,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ProjectTask,
  TaskStatus,
  TaskSubtask,
  UpdateTaskInput,
} from "@/types/task";
import { PRIORITY_CONFIG } from "@/types/task";

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

interface TaskItemProps {
  task: ProjectTask;
  onUpdate: (id: string, input: UpdateTaskInput) => void;
  onDelete: (id: string) => Promise<boolean>;
}

function TaskItem({ task, onUpdate, onDelete }: TaskItemProps) {
  const [expanded, setExpanded] = useState(false);
  const StatusIcon = STATUS_ICONS[task.status];
  const priorityConfig = PRIORITY_CONFIG[task.priority];

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;

  const toggleSubtask = (subtaskId: string) => {
    const updated = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    onUpdate(task.id, { subtasks: updated });
  };

  const addSubtask = (title: string) => {
    const newSubtask: TaskSubtask = {
      id: crypto.randomUUID(),
      title,
      completed: false,
    };
    onUpdate(task.id, { subtasks: [...task.subtasks, newSubtask] });
  };

  return (
    <div
      className={cn(
        "group px-2 py-1.5 rounded-md transition-all duration-150",
        "hover:bg-accent/50",
        task.status === "done" && "opacity-60"
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
            onClick={() => setExpanded(!expanded)}
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

            {/* Source badge */}
            {task.source === "agent" && (
              <Bot className="w-2.5 h-2.5 text-primary/60" />
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

      {/* Expanded: subtasks */}
      {expanded && (
        <div className="mt-1.5 ml-5 space-y-1">
          {task.subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-1.5">
              <button onClick={() => toggleSubtask(sub.id)}>
                {sub.completed ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
              <span
                className={cn(
                  "text-[11px]",
                  sub.completed
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {sub.title}
              </span>
            </div>
          ))}
          <SubtaskQuickAdd onAdd={addSubtask} />
        </div>
      )}
    </div>
  );
}

function SubtaskQuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-1">
      <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
        placeholder="Add subtask..."
        className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none"
      />
    </div>
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

// --- GitHub issue link item ---

interface GitHubIssueLinkProps {
  issue: { number: number; title: string; htmlUrl: string; state: string };
  onLink: () => void;
}

function GitHubIssueLink({ issue, onLink }: GitHubIssueLinkProps) {
  return (
    <div className="flex items-start gap-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors group">
      {issue.state === "open" ? (
        <CircleDot className="w-3.5 h-3.5 text-chart-2 mt-0.5 shrink-0" />
      ) : (
        <CircleCheck className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <a
          href={issue.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-foreground hover:underline line-clamp-1"
        >
          <span className="text-primary mr-1">#{issue.number}</span>
          {issue.title}
        </a>
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

// --- Main TaskSidebar ---

interface TaskSidebarProps {
  githubRepoId: string | null;
}

export function TaskSidebar({ githubRepoId }: TaskSidebarProps) {
  const { tasks, loading, createTask, updateTask, deleteTask, activeFolderId } =
    useTaskContext();

  // Sidebar state
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [width, setWidth] = useState(getStoredWidth);

  // Section expand state
  const [manualExpanded, setManualExpanded] = useState(true);
  const [agentExpanded, setAgentExpanded] = useState(true);
  const [issuesExpanded, setIssuesExpanded] = useState(false);

  // GitHub issues from existing context
  const { issues: rawIssues, isLoading: issuesLoading, refresh: refreshIssues } =
    useRepositoryIssues(githubRepoId);

  const githubIssues = useMemo(
    () =>
      rawIssues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        state: issue.state,
      })),
    [rawIssues]
  );

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

  // Split tasks by source
  const manualTasks = useMemo(
    () => tasks.filter((t) => t.source === "manual"),
    [tasks]
  );
  const agentTasks = useMemo(
    () => tasks.filter((t) => t.source === "agent"),
    [tasks]
  );

  const openTaskCount = useMemo(
    () => tasks.filter((t) => t.status === "open" || t.status === "in_progress").length,
    [tasks]
  );

  const activeManualCount = useMemo(
    () => manualTasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
    [manualTasks]
  );

  const activeAgentCount = useMemo(
    () => agentTasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
    [agentTasks]
  );

  // Handlers
  const handleAddTask = useCallback(
    (title: string) => {
      createTask({ title, folderId: activeFolderId });
    },
    [createTask, activeFolderId]
  );

  const handleLinkIssue = useCallback(
    (issue: { number: number; title: string; htmlUrl: string }) => {
      createTask({
        title: issue.title,
        folderId: activeFolderId,
        githubIssueUrl: issue.htmlUrl,
        description: `Linked from GitHub #${issue.number}`,
      });
    },
    [createTask, activeFolderId]
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

      {/* No folder selected */}
      {!activeFolderId ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-xs text-muted-foreground text-center">
            Select a project folder to view tasks
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1">
            {/* Manual Tasks Section */}
            <div>
              <SectionHeader
                icon={ClipboardList}
                title="Tasks"
                count={activeManualCount}
                expanded={manualExpanded}
                onToggle={() => setManualExpanded(!manualExpanded)}
              />
              {manualExpanded && (
                <>
                  <QuickAdd onAdd={handleAddTask} />
                  <div className="space-y-0.5 px-1">
                    {manualTasks.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground px-3 py-2">
                        No tasks yet. Add one above.
                      </p>
                    ) : (
                      manualTasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
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

            {/* Agent Tasks Section */}
            <div>
              <SectionHeader
                icon={Bot}
                title="Agent Tasks"
                count={activeAgentCount}
                expanded={agentExpanded}
                onToggle={() => setAgentExpanded(!agentExpanded)}
              />
              {agentExpanded && (
                <div className="space-y-0.5 px-1">
                  {agentTasks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-3 py-2">
                      No agent tasks. Agents create tasks via MCP or API.
                    </p>
                  ) : (
                    agentTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onUpdate={updateTask}
                        onDelete={deleteTask}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="border-t border-border my-1" />

            {/* GitHub Issues Section */}
            <div>
              <SectionHeader
                icon={CircleDot}
                title="GitHub Issues"
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
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-card/50 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
