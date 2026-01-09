"use client";

/**
 * OrchestratorChatInterface - Chat-style natural language input.
 *
 * Features:
 * - Natural language task submission
 * - Task history as chat messages
 * - Plan confirmation dialog
 * - Autonomy level toggle
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Brain,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { useTaskContext, type Task, type ExecutionPlan } from "@/contexts/TaskContext";
import { useTaskExecution } from "@/hooks/useTaskExecution";
import { AutonomyLevelToggle, type AutonomyLevel } from "./AutonomyLevelToggle";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestratorChatInterfaceProps {
  folderId?: string;
  folderPath?: string;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  type: "user" | "system" | "task";
  content: string;
  timestamp: Date;
  task?: Task;
  plan?: ExecutionPlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function OrchestratorChatInterface({
  folderId,
  folderPath,
  className,
}: OrchestratorChatInterfaceProps) {
  const { state } = useTaskContext();
  const {
    submitting,
    planning,
    executing,
    currentPlan,
    error,
    submit,
    plan,
    execute,
    cancel,
    clearError,
  } = useTaskExecution();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>("confirm");
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [pendingTask, setPendingTask] = useState<Task | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Convert tasks to messages
  useEffect(() => {
    const taskMessages: ChatMessage[] = state.tasks.map((task) => ({
      id: task.id,
      type: "task" as const,
      content: task.description,
      timestamp: task.createdAt,
      task,
    }));

    setMessages(taskMessages);
  }, [state.tasks]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle plan dialog
  useEffect(() => {
    if (currentPlan && pendingTask && autonomyLevel === "confirm") {
      setShowPlanDialog(true);
    }
  }, [currentPlan, pendingTask, autonomyLevel]);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || submitting) return;

    const taskInput = input.trim();
    setInput("");

    try {
      const task = await submit(taskInput, { folderId });
      setPendingTask(task);

      // If autonomy level is full, auto-execute
      if (autonomyLevel === "full" && folderPath) {
        const executionPlan = await plan(task.id, folderPath);
        await execute(task.id, executionPlan);
        setPendingTask(null);
      } else if (autonomyLevel === "confirm" && folderPath) {
        // Plan but wait for confirmation
        await plan(task.id, folderPath);
      }
      // If manual, just queue the task
    } catch (e) {
      // Error is already handled by the hook
      console.error("Task submission failed:", e);
    }
  }, [input, submit, plan, execute, folderId, folderPath, autonomyLevel, submitting]);

  // Confirm plan execution
  const handleConfirmPlan = useCallback(async () => {
    if (!pendingTask || !currentPlan) return;

    setShowPlanDialog(false);

    try {
      await execute(pendingTask.id, currentPlan);
    } catch (e) {
      console.error("Task execution failed:", e);
    } finally {
      setPendingTask(null);
    }
  }, [pendingTask, currentPlan, execute]);

  // Cancel pending task
  const handleCancelPlan = useCallback(async () => {
    if (!pendingTask) return;

    setShowPlanDialog(false);

    try {
      await cancel(pendingTask.id);
    } catch (e) {
      console.error("Task cancellation failed:", e);
    } finally {
      setPendingTask(null);
    }
  }, [pendingTask, cancel]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const isLoading = submitting || planning || executing;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Orchestrator</h3>
        </div>
        <AutonomyLevelToggle value={autonomyLevel} onChange={setAutonomyLevel} />
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>What would you like me to work on?</p>
              <p className="text-sm mt-1">
                Describe a task in natural language
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">
                {submitting
                  ? "Submitting..."
                  : planning
                    ? "Planning execution..."
                    : "Executing..."}
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearError}
                className="h-6 px-2"
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want me to do..."
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to submit, Shift+Enter for new line
        </p>
      </div>

      {/* Plan Confirmation Dialog */}
      <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Execution Plan</DialogTitle>
            <DialogDescription>
              Review the planned execution before proceeding
            </DialogDescription>
          </DialogHeader>

          {currentPlan && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-1">Agent</h4>
                <Badge variant="outline" className="capitalize">
                  {currentPlan.selectedAgent}
                </Badge>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Isolation Strategy</h4>
                <Badge variant="secondary" className="capitalize">
                  {currentPlan.isolationStrategy}
                </Badge>
                {currentPlan.branchName && (
                  <span className="text-sm text-muted-foreground ml-2">
                    Branch: {currentPlan.branchName}
                  </span>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Reasoning</h4>
                <p className="text-sm text-muted-foreground">
                  {currentPlan.reasoning}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Estimated Tokens</h4>
                <p className="text-sm text-muted-foreground">
                  ~{currentPlan.estimatedTokens.toLocaleString()} tokens
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelPlan}>
              Cancel
            </Button>
            <Button onClick={handleConfirmPlan}>
              <ChevronRight className="h-4 w-4 mr-1" />
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Bubble Component
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.type === "task" && message.task) {
    return <TaskMessage task={message.task} />;
  }

  return (
    <div
      className={cn(
        "flex gap-2",
        message.type === "user" ? "justify-end" : "justify-start"
      )}
    >
      {message.type === "system" && (
        <Brain className="h-6 w-6 text-primary shrink-0" />
      )}
      <div
        className={cn(
          "rounded-lg px-3 py-2 max-w-[80%]",
          message.type === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
      {message.type === "user" && (
        <User className="h-6 w-6 text-muted-foreground shrink-0" />
      )}
    </div>
  );
}

function TaskMessage({ task }: { task: Task }) {
  const statusIcon = {
    queued: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
    planning: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
    executing: <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />,
    monitoring: <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />,
    completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    failed: <XCircle className="h-4 w-4 text-red-500" />,
    cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  };

  return (
    <Card className="max-w-[90%]">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {statusIcon[task.status]}
          <CardTitle className="text-sm">{task.description}</CardTitle>
        </div>
        <CardDescription className="text-xs">
          {task.status} • {task.type}
          {task.assignedAgent && ` • ${task.assignedAgent}`}
        </CardDescription>
      </CardHeader>
      {task.result?.summary && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{task.result.summary}</p>
        </CardContent>
      )}
      {task.error && (
        <CardContent className="pt-0">
          <p className="text-sm text-red-500">{task.error.message}</p>
        </CardContent>
      )}
    </Card>
  );
}
