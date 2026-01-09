"use client";

/**
 * TaskStatusCard - Display task status with progress indicator.
 *
 * Shows:
 * - Task description and type
 * - Current status with visual indicator
 * - Assigned agent and delegation info
 * - Time elapsed and estimated duration
 * - Actions (cancel, retry)
 */

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  PauseCircle,
  Ban,
  Brain,
  Bug,
  RefreshCw,
  FileText,
  HelpCircle,
  X,
} from "lucide-react";
import type { Task, TaskStatus, TaskType } from "@/contexts/TaskContext";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface TaskStatusCardProps {
  task: Task;
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onSelect?: (taskId: string) => void;
  selected?: boolean;
  compact?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Configuration
// ─────────────────────────────────────────────────────────────────────────────

const statusConfig: Record<
  TaskStatus,
  { icon: React.ElementType; color: string; label: string }
> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  planning: { icon: Brain, color: "text-blue-500", label: "Planning" },
  executing: { icon: PlayCircle, color: "text-yellow-500", label: "Executing" },
  monitoring: { icon: PauseCircle, color: "text-purple-500", label: "Monitoring" },
  completed: { icon: CheckCircle2, color: "text-green-500", label: "Completed" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelled" },
};

const typeConfig: Record<TaskType, { icon: React.ElementType; label: string }> = {
  feature: { icon: PlayCircle, label: "Feature" },
  bug: { icon: Bug, label: "Bug Fix" },
  refactor: { icon: RefreshCw, label: "Refactor" },
  test: { icon: CheckCircle2, label: "Test" },
  docs: { icon: FileText, label: "Docs" },
  query: { icon: HelpCircle, label: "Query" },
  unknown: { icon: HelpCircle, label: "Unknown" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TaskStatusCard({
  task,
  onCancel,
  onRetry,
  onSelect,
  selected = false,
  compact = false,
}: TaskStatusCardProps) {
  const status = statusConfig[task.status];
  const type = typeConfig[task.type];
  const StatusIcon = status.icon;
  const TypeIcon = type.icon;

  const isActive = task.status === "executing" || task.status === "monitoring";
  const isCancellable =
    task.status === "queued" ||
    task.status === "planning" ||
    task.status === "executing";
  const isRetryable = task.status === "failed";

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
          selected
            ? "bg-accent border-accent-foreground/20"
            : "hover:bg-accent/50",
          isActive && "animate-pulse"
        )}
        onClick={() => onSelect?.(task.id)}
      >
        <StatusIcon className={cn("h-4 w-4", status.color)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.description}</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(task.createdAt, { addSuffix: true })}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {type.label}
        </Badge>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "transition-all",
        selected && "ring-2 ring-primary",
        isActive && "border-primary/50"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("h-5 w-5", status.color)} />
            <Badge variant="secondary" className="gap-1">
              <TypeIcon className="h-3 w-3" />
              {type.label}
            </Badge>
          </div>
          {isCancellable && onCancel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCancel(task.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <CardTitle className="text-base leading-tight mt-2">
          {task.description}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          <span>{status.label}</span>
          {task.assignedAgent && (
            <>
              <span>•</span>
              <span className="capitalize">{task.assignedAgent}</span>
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-2">
        {/* Progress indicator for active tasks */}
        {isActive && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Running for{" "}
              {formatDistanceToNow(task.createdAt, { addSuffix: false })}
            </span>
          </div>
        )}

        {/* Completion info */}
        {task.status === "completed" && task.result && (
          <div className="text-sm">
            <p className="text-muted-foreground">{task.result.summary}</p>
            {task.result.filesModified.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Modified {task.result.filesModified.length} file(s)
              </p>
            )}
          </div>
        )}

        {/* Error info */}
        {task.status === "failed" && task.error && (
          <div className="text-sm text-red-500">
            <p>{task.error.message}</p>
            {task.error.recoverable && (
              <p className="text-xs text-muted-foreground mt-1">
                This error may be recoverable
              </p>
            )}
          </div>
        )}

        {/* Confidence indicator */}
        {task.confidence < 1 && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Confidence</span>
              <span>{Math.round(task.confidence * 100)}%</span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${task.confidence * 100}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-between text-xs text-muted-foreground">
        <span>
          Created {formatDistanceToNow(task.createdAt, { addSuffix: true })}
        </span>
        {isRetryable && onRetry && (
          <Button variant="outline" size="sm" onClick={() => onRetry(task.id)}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
