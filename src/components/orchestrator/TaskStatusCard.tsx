"use client";

/**
 * TaskStatusCard - Display task status with progress indicator and streaming updates.
 *
 * Shows:
 * - Task description and type
 * - Current status with visual indicator
 * - Assigned agent and delegation info
 * - Time elapsed and estimated duration
 * - Execution steps with real-time progress
 * - Terminal output (buffered for readability)
 * - Tool calls and their results
 * - Actions (cancel, retry)
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronDown,
  Terminal,
  Wrench,
  Circle,
} from "lucide-react";
import type { Task, TaskStatus, TaskType } from "@/contexts/TaskContext";

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionStep {
  id: string;
  type: "planning" | "setup" | "execution" | "validation" | "cleanup";
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  details?: string;
  error?: string;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface TaskStatusCardProps {
  task: Task;
  orchestratorId?: string; // Required for streaming
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onSelect?: (taskId: string) => void;
  selected?: boolean;
  compact?: boolean;
  enableStreaming?: boolean; // Enable real-time streaming updates
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
// Streaming Hook
// ─────────────────────────────────────────────────────────────────────────────

interface StreamingState {
  connected: boolean;
  steps: ExecutionStep[];
  toolCalls: ToolCall[];
  outputLines: string[];
  currentStep: ExecutionStep | null;
}

function useTaskStreaming(
  orchestratorId: string | undefined,
  taskId: string,
  enabled: boolean,
  isActive: boolean
): StreamingState {
  const [state, setState] = useState<StreamingState>({
    connected: false,
    steps: [],
    toolCalls: [],
    outputLines: [],
    currentStep: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      switch (event.type) {
        case "connected":
          setState((prev) => ({
            ...prev,
            connected: true,
            steps: data.data.steps || [],
            toolCalls: data.data.toolCalls || [],
          }));
          break;

        case "step_start":
          setState((prev) => ({
            ...prev,
            currentStep: data.data,
            steps: prev.steps.some((s) => s.id === data.data.id)
              ? prev.steps.map((s) => (s.id === data.data.id ? data.data : s))
              : [...prev.steps, data.data],
          }));
          break;

        case "step_complete":
          setState((prev) => ({
            ...prev,
            currentStep: null,
            steps: prev.steps.map((s) =>
              s.id === data.data.id ? data.data : s
            ),
          }));
          break;

        case "tool_call":
          setState((prev) => ({
            ...prev,
            toolCalls: [...prev.toolCalls, data.data],
          }));
          break;

        case "tool_result":
          setState((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((t) =>
              t.id === data.data.id ? data.data : t
            ),
          }));
          break;

        case "output":
          setState((prev) => ({
            ...prev,
            outputLines: [...prev.outputLines.slice(-100), ...data.data.lines],
          }));
          break;
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  useEffect(() => {
    if (!enabled || !orchestratorId || !isActive) {
      return;
    }

    const url = `/api/orchestrators/${orchestratorId}/tasks/${taskId}/stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Listen for all event types
    const eventTypes = [
      "connected",
      "status_change",
      "step_start",
      "step_complete",
      "command",
      "output",
      "tool_call",
      "tool_result",
      "progress",
      "completed",
      "failed",
      "cancelled",
    ];

    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, handleEvent);
    });

    eventSource.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [orchestratorId, taskId, enabled, isActive, handleEvent]);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: ExecutionStep }) {
  const iconClass = "h-3 w-3";

  switch (step.status) {
    case "running":
      return <Loader2 className={cn(iconClass, "animate-spin text-blue-500")} />;
    case "completed":
      return <CheckCircle2 className={cn(iconClass, "text-green-500")} />;
    case "failed":
      return <XCircle className={cn(iconClass, "text-red-500")} />;
    case "skipped":
      return <Circle className={cn(iconClass, "text-muted-foreground")} />;
    default:
      return <Circle className={cn(iconClass, "text-muted-foreground")} />;
  }
}

function ExecutionSteps({ steps }: { steps: ExecutionStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1">
      {steps.map((step) => (
        <div key={step.id} className="flex items-center gap-2 text-xs">
          <StepIndicator step={step} />
          <span className={cn(
            step.status === "running" && "font-medium",
            step.status === "failed" && "text-red-500",
            step.status === "skipped" && "text-muted-foreground line-through"
          )}>
            {step.name}
          </span>
          {step.details && (
            <span className="text-muted-foreground">- {step.details}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (toolCalls.length === 0) return null;

  // Show only last 5 tool calls
  const recentCalls = toolCalls.slice(-5);

  return (
    <div className="space-y-1">
      {recentCalls.map((call) => (
        <div key={call.id} className="flex items-center gap-2 text-xs">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono">{call.name}</span>
          {call.completedAt ? (
            call.error ? (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">error</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1 py-0">done</Badge>
            )
          ) : (
            <Loader2 className="h-2 w-2 animate-spin" />
          )}
        </div>
      ))}
    </div>
  );
}

function TerminalOutput({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="bg-background/80 border rounded-md p-2 font-mono text-[10px] max-h-32 overflow-y-auto"
    >
      {lines.slice(-20).map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all text-muted-foreground">
          {line}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TaskStatusCard({
  task,
  orchestratorId,
  onCancel,
  onRetry,
  onSelect,
  selected = false,
  compact = false,
  enableStreaming = false,
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

  // Streaming state
  const streaming = useTaskStreaming(
    orchestratorId,
    task.id,
    enableStreaming,
    isActive
  );

  const [showDetails, setShowDetails] = useState(false);

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
            {streaming.connected && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Circle className="h-1.5 w-1.5 fill-green-500 text-green-500" />
                Live
              </Badge>
            )}
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

      <CardContent className="pb-2 space-y-3">
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

        {/* Execution steps (streaming) */}
        {streaming.steps.length > 0 && (
          <div className="border-l-2 border-primary/30 pl-3">
            <ExecutionSteps steps={streaming.steps} />
          </div>
        )}

        {/* Tool calls (streaming) */}
        {streaming.toolCalls.length > 0 && (
          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between px-2 h-7"
              >
                <span className="flex items-center gap-1 text-xs">
                  <Wrench className="h-3 w-3" />
                  {streaming.toolCalls.length} tool call(s)
                </span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showDetails && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ToolCallList toolCalls={streaming.toolCalls} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Terminal output (streaming) */}
        {streaming.outputLines.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between px-2 h-7"
              >
                <span className="flex items-center gap-1 text-xs">
                  <Terminal className="h-3 w-3" />
                  Terminal output
                </span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <TerminalOutput lines={streaming.outputLines} />
            </CollapsibleContent>
          </Collapsible>
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
