"use client";

/**
 * TaskTimeline - Timeline view of all tasks.
 *
 * Shows:
 * - Chronological list of tasks
 * - Status indicators
 * - Time grouping (today, yesterday, older)
 * - Filter by status
 */

import { useMemo, useState } from "react";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Filter,
} from "lucide-react";
import { TaskStatusCard } from "./TaskStatusCard";
import type { Task } from "@/contexts/TaskContext";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface TaskTimelineProps {
  tasks: Task[];
  selectedTaskId?: string | null;
  onTaskSelect?: (taskId: string) => void;
  onTaskCancel?: (taskId: string) => void;
  onTaskRetry?: (taskId: string) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Filters
// ─────────────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "active" | "completed" | "failed";

const statusFilters: { value: StatusFilter; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: Clock },
  { value: "active", label: "Active", icon: PlayCircle },
  { value: "completed", label: "Done", icon: CheckCircle2 },
  { value: "failed", label: "Failed", icon: XCircle },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TaskTimeline({
  tasks,
  selectedTaskId,
  onTaskSelect,
  onTaskCancel,
  onTaskRetry,
  className,
}: TaskTimelineProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Filter tasks
  const filteredTasks = useMemo(() => {
    switch (filter) {
      case "active":
        return tasks.filter(
          (t) =>
            t.status === "queued" ||
            t.status === "planning" ||
            t.status === "executing" ||
            t.status === "monitoring"
        );
      case "completed":
        return tasks.filter((t) => t.status === "completed");
      case "failed":
        return tasks.filter(
          (t) => t.status === "failed" || t.status === "cancelled"
        );
      default:
        return tasks;
    }
  }, [tasks, filter]);

  // Group tasks by date
  const groupedTasks = useMemo(() => {
    const groups: { label: string; date: Date; tasks: Task[] }[] = [];
    const dateMap = new Map<string, Task[]>();

    for (const task of filteredTasks) {
      const dayStart = startOfDay(task.createdAt);
      const key = dayStart.toISOString();

      if (!dateMap.has(key)) {
        dateMap.set(key, []);
      }
      dateMap.get(key)!.push(task);
    }

    // Sort by date descending
    const sortedDates = Array.from(dateMap.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );

    for (const [dateKey, dateTasks] of sortedDates) {
      const date = new Date(dateKey);
      let label: string;

      if (isToday(date)) {
        label = "Today";
      } else if (isYesterday(date)) {
        label = "Yesterday";
      } else {
        label = format(date, "MMMM d, yyyy");
      }

      groups.push({ label, date, tasks: dateTasks });
    }

    return groups;
  }, [filteredTasks]);

  // Count active tasks
  const activeTasks = tasks.filter(
    (t) =>
      t.status === "queued" ||
      t.status === "planning" ||
      t.status === "executing" ||
      t.status === "monitoring"
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header with filters */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Tasks</h3>
          {activeTasks.length > 0 && (
            <Badge variant="secondary" className="animate-pulse">
              {activeTasks.length} active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Filter className="h-4 w-4 text-muted-foreground mr-1" />
          {statusFilters.map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setFilter(f.value)}
            >
              <f.icon className="h-3 w-3 mr-1" />
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {groupedTasks.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No tasks yet</p>
              <p className="text-sm">
                Submit a task using the chat interface
              </p>
            </div>
          ) : (
            groupedTasks.map((group) => (
              <div key={group.label}>
                <h4 className="text-sm font-medium text-muted-foreground mb-3 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-1">
                  {group.label}
                </h4>
                <div className="space-y-3">
                  {group.tasks.map((task) => (
                    <TaskStatusCard
                      key={task.id}
                      task={task}
                      selected={task.id === selectedTaskId}
                      onSelect={onTaskSelect}
                      onCancel={onTaskCancel}
                      onRetry={onTaskRetry}
                      compact
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
