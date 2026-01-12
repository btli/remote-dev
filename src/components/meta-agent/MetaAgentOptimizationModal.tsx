"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Clock,
  Target,
  BarChart3,
  FileCode2,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MetaAgentOptimizationModalProps {
  open: boolean;
  onClose: () => void;
  sessionId?: string;
  folderId?: string;
  folderPath?: string;
  agentProvider?: "claude" | "codex" | "gemini" | "opencode";
  taskDescription?: string;
}

interface OptimizationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: {
    currentIteration: number;
    maxIterations: number;
    percentage: number;
  };
  scores: {
    current: number | null;
    target: number;
    history: number[];
    reachedTarget: boolean;
  };
  iterations: Array<{
    iteration: number;
    score: number;
    configVersion: number;
    suggestionsApplied: number;
    iterationDurationMs: number;
  }>;
  timing: {
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  };
  result: {
    configId: string | null;
    stopReason: string | null;
    error: string | null;
    finalScore: number | null;
  } | null;
}

interface AgentConfig {
  id: string;
  name: string;
  provider: string;
  version: number;
  systemPrompt: string;
  instructionsFile: string;
}

type Phase = "configure" | "running" | "completed" | "failed";

/**
 * MetaAgentOptimizationModal - Trigger and monitor config optimization
 *
 * Shows the BUILD → TEST → IMPROVE loop progress.
 * Displays before/after config comparison when complete.
 * Allows confirming or discarding changes.
 */
export function MetaAgentOptimizationModal({
  open,
  onClose,
  sessionId,
  folderId,
  folderPath,
  agentProvider = "claude",
  taskDescription: initialTaskDescription,
}: MetaAgentOptimizationModalProps) {
  // Configuration state
  const [taskDescription, setTaskDescription] = useState(initialTaskDescription || "");
  const [maxIterations, setMaxIterations] = useState(3);
  const [targetScore, setTargetScore] = useState(0.9);

  // Job state
  const [phase, setPhase] = useState<Phase>("configure");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<OptimizationJob | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // SSE connection
  const eventSourceRef = useRef<EventSource | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPhase("configure");
      setJobId(null);
      setJob(null);
      setConfig(null);
      setError(null);
      setTaskDescription(initialTaskDescription || "");
    }
    return () => {
      eventSourceRef.current?.close();
    };
  }, [open, initialTaskDescription]);

  /**
   * Start optimization job
   */
  const handleStart = useCallback(async () => {
    setIsStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/sdk/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: {
            id: `task-${Date.now()}`,
            taskType: "feature",
            description: taskDescription,
            acceptanceCriteria: [],
            relevantFiles: [],
            constraints: [],
          },
          context: {
            projectPath: folderPath || "/unknown",
            projectType: "unknown",
            language: "typescript",
            frameworks: [],
            packageManager: "bun",
            hasCi: false,
            folderId,
          },
          options: {
            maxIterations,
            targetScore,
            async: true,
            sessionId,
            folderId,
            provider: agentProvider,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start optimization");
      }

      const data = await response.json();
      setJobId(data.jobId);
      setPhase("running");

      // Connect to SSE stream
      connectToStream(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start optimization");
    } finally {
      setIsStarting(false);
    }
  }, [taskDescription, maxIterations, targetScore, sessionId, folderId, folderPath, agentProvider]);

  /**
   * Connect to SSE stream for real-time updates
   */
  const connectToStream = useCallback((id: string) => {
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/sdk/meta/stream?jobId=${id}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleSSEEvent(data);
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // Fallback to polling if SSE fails
      es.close();
      pollStatus(id);
    };

    // Also listen for specific event types
    es.addEventListener("connected", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        handleSSEEvent(data);
      } catch {
        // Ignore
      }
    });

    es.addEventListener("progress", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        handleSSEEvent(data);
      } catch {
        // Ignore
      }
    });

    es.addEventListener("completed", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        handleSSEEvent(data);
        es.close();
      } catch {
        // Ignore
      }
    });

    es.addEventListener("failed", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        handleSSEEvent(data);
        es.close();
      } catch {
        // Ignore
      }
    });
  }, []);

  /**
   * Handle SSE events
   */
  const handleSSEEvent = useCallback(async (event: { type: string; data: unknown }) => {
    switch (event.type) {
      case "connected":
      case "status":
      case "progress":
      case "score":
      case "iteration":
        // Refresh job status
        if (jobId) {
          await fetchJobStatus(jobId);
        }
        break;

      case "completed":
        setPhase("completed");
        if (jobId) {
          await fetchJobStatus(jobId);
          await fetchConfig(jobId);
        }
        break;

      case "failed":
      case "cancelled":
        setPhase("failed");
        if (jobId) {
          await fetchJobStatus(jobId);
        }
        break;
    }
  }, [jobId]);

  /**
   * Poll job status (fallback for SSE)
   */
  const pollStatus = useCallback(async (id: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/sdk/meta/status/${id}`);
        if (!response.ok) return;

        const data = await response.json();
        setJob({
          id: data.id,
          status: data.status,
          progress: data.progress,
          scores: data.scores,
          iterations: data.iterations,
          timing: data.timing,
          result: data.result,
        });

        if (data.status === "completed") {
          setPhase("completed");
          await fetchConfig(id);
        } else if (data.status === "failed" || data.status === "cancelled") {
          setPhase("failed");
          if (data.result?.error) {
            setError(data.result.error);
          }
        } else {
          // Continue polling
          setTimeout(poll, 1000);
        }
      } catch {
        // Retry on error
        setTimeout(poll, 2000);
      }
    };

    poll();
  }, []);

  /**
   * Fetch job status
   */
  const fetchJobStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/sdk/meta/status/${id}`);
      if (!response.ok) return;

      const data = await response.json();
      setJob({
        id: data.id,
        status: data.status,
        progress: data.progress,
        scores: data.scores,
        iterations: data.iterations,
        timing: data.timing,
        result: data.result,
      });
    } catch {
      // Ignore fetch errors
    }
  }, []);

  /**
   * Fetch generated config
   */
  const fetchConfig = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/sdk/meta?jobId=${id}`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.config) {
        setConfig(data.config);
      }
    } catch {
      // Ignore fetch errors
    }
  }, []);

  /**
   * Cancel running job
   */
  const handleCancel = useCallback(async () => {
    if (!jobId) return;

    try {
      await fetch(`/api/sdk/meta/status/${jobId}`, { method: "DELETE" });
      eventSourceRef.current?.close();
      setPhase("failed");
      setError("Optimization cancelled");
    } catch {
      // Ignore errors
    }
  }, [jobId]);

  /**
   * Apply generated config - copies to clipboard for manual application
   */
  const handleApply = useCallback(async () => {
    if (!config) return;

    setIsApplying(true);
    try {
      // Copy the instructions file content to clipboard
      await navigator.clipboard.writeText(config.instructionsFile);
      toast.success("Configuration copied to clipboard", {
        description: `Paste into your ${agentProvider === "claude" ? "CLAUDE.md" : "config"} file to apply`,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to copy config";
      setError(message);
      toast.error(message);
    } finally {
      setIsApplying(false);
    }
  }, [config, agentProvider, onClose]);

  /**
   * Format duration in human-readable form
   */
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  /**
   * Get status color
   */
  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed":
        return "text-green-500";
      case "running":
        return "text-blue-500";
      case "failed":
      case "cancelled":
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[700px] bg-popover/95 backdrop-blur-xl border-border max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle>Config Optimization</DialogTitle>
          </div>
          <DialogDescription>
            {phase === "configure" && "Configure and run the BUILD → TEST → IMPROVE optimization loop."}
            {phase === "running" && "Optimizing configuration..."}
            {phase === "completed" && "Optimization complete! Review the generated configuration."}
            {phase === "failed" && "Optimization failed or was cancelled."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto py-4">
          {/* Configure Phase */}
          {phase === "configure" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="taskDescription">Task Description</Label>
                <Textarea
                  id="taskDescription"
                  rows={3}
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="Describe what you want the agent to accomplish..."
                />
                <p className="text-xs text-muted-foreground">
                  Be specific about the goal, constraints, and expected outcomes.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxIterations">Max Iterations</Label>
                  <Input
                    id="maxIterations"
                    type="number"
                    min={1}
                    max={10}
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                  />
                  <p className="text-xs text-muted-foreground">
                    BUILD → TEST → IMPROVE cycles (1-10)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="targetScore">Target Score</Label>
                  <Input
                    id="targetScore"
                    type="number"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={targetScore}
                    onChange={(e) => setTargetScore(Math.max(0.5, Math.min(1.0, parseFloat(e.target.value) || 0.9)))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stop when score reaches this (0.5-1.0)
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Agent:</span>
                  <Badge variant="secondary">{agentProvider}</Badge>
                  {folderId && (
                    <>
                      <span className="text-muted-foreground ml-2">Folder:</span>
                      <Badge variant="outline">{folderPath || folderId}</Badge>
                    </>
                  )}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Running Phase */}
          {phase === "running" && job && (
            <div className="space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Iteration {job.progress.currentIteration} of {job.progress.maxIterations}
                  </span>
                  <span className="font-medium">{job.progress.percentage}%</span>
                </div>
                <Progress value={job.progress.percentage} className="h-2" />
              </div>

              {/* Phase Indicator */}
              <div className="flex items-center justify-center gap-2 py-4">
                <PhaseStep
                  label="BUILD"
                  active={job.progress.currentIteration > 0}
                  complete={job.progress.currentIteration > 0}
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <PhaseStep
                  label="TEST"
                  active={job.scores.current !== null}
                  complete={job.scores.current !== null}
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <PhaseStep
                  label="IMPROVE"
                  active={job.progress.currentIteration > 1}
                  complete={job.progress.currentIteration > 1}
                />
              </div>

              {/* Score Progress */}
              {job.scores.current !== null && (
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Score Progress</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      Target: {job.scores.target.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-end gap-1 h-16">
                    {job.scores.history.map((score, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-t transition-all",
                          score >= job.scores.target
                            ? "bg-green-500"
                            : "bg-primary"
                        )}
                        style={{ height: `${score * 100}%` }}
                        title={`Iteration ${i + 1}: ${score.toFixed(3)}`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-center">
                    <span className="text-2xl font-bold text-primary">
                      {(job.scores.current * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Iteration History */}
              {job.iterations.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <BarChart3 className="h-4 w-4" />
                    Iteration History
                  </div>
                  <div className="space-y-1">
                    {job.iterations.map((iter) => (
                      <div
                        key={iter.iteration}
                        className="flex items-center justify-between text-xs p-2 rounded bg-muted/50"
                      >
                        <span>Iteration {iter.iteration}</span>
                        <span>Score: {iter.score.toFixed(3)}</span>
                        <span>{iter.suggestionsApplied} suggestions</span>
                        <span className="text-muted-foreground">
                          {formatDuration(iter.iterationDurationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed Phase */}
          {phase === "completed" && job && (
            <div className="space-y-4">
              {/* Success Banner */}
              <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                  <div>
                    <h3 className="font-medium">Optimization Complete</h3>
                    <p className="text-sm text-muted-foreground">
                      {job.result?.stopReason === "target_reached"
                        ? "Target score reached!"
                        : `Completed after ${job.progress.currentIteration} iterations`}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-2xl font-bold text-green-500">
                      {((job.scores.current || 0) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Final Score</div>
                  </div>
                </div>
              </div>

              {/* Timing Info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Duration: {job.timing.durationMs ? formatDuration(job.timing.durationMs) : "N/A"}</span>
                </div>
                <span>{job.progress.currentIteration} iterations</span>
              </div>

              {/* Config Comparison Tabs */}
              {config && (
                <Tabs defaultValue="instructions" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="instructions">
                      <FileCode2 className="h-4 w-4 mr-2" />
                      Instructions
                    </TabsTrigger>
                    <TabsTrigger value="prompt">
                      <Settings2 className="h-4 w-4 mr-2" />
                      System Prompt
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="instructions">
                    <ScrollArea className="h-[200px] rounded-lg border border-border bg-muted/50 p-3">
                      <pre className="text-xs whitespace-pre-wrap font-mono">
                        {config.instructionsFile}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="prompt">
                    <ScrollArea className="h-[200px] rounded-lg border border-border bg-muted/50 p-3">
                      <pre className="text-xs whitespace-pre-wrap font-mono">
                        {config.systemPrompt}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              )}

              {/* Config Metadata */}
              {config && (
                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Config ID:</span>
                      <p className="font-mono text-xs truncate">{config.id}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Provider:</span>
                      <p className="font-medium">{config.provider}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Version:</span>
                      <p className="font-medium">{config.version}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Failed Phase */}
          {phase === "failed" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                <div className="flex items-center gap-3">
                  <XCircle className="h-8 w-8 text-red-500" />
                  <div>
                    <h3 className="font-medium text-red-500">Optimization Failed</h3>
                    <p className="text-sm text-muted-foreground">
                      {error || job?.result?.error || "The optimization was cancelled or encountered an error."}
                    </p>
                  </div>
                </div>
              </div>

              {job && job.iterations.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <BarChart3 className="h-4 w-4" />
                    Partial Progress
                  </div>
                  <div className="space-y-1">
                    {job.iterations.map((iter) => (
                      <div
                        key={iter.iteration}
                        className="flex items-center justify-between text-xs p-2 rounded bg-muted/50"
                      >
                        <span>Iteration {iter.iteration}</span>
                        <span>Score: {iter.score.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {phase === "configure" && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleStart}
                disabled={isStarting || !taskDescription.trim()}
              >
                {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Play className="mr-2 h-4 w-4" />
                Start Optimization
              </Button>
            </>
          )}

          {phase === "running" && (
            <>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Optimizing...
              </Button>
            </>
          )}

          {phase === "completed" && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleApply} disabled={isApplying || !config}>
                {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Apply Config
              </Button>
            </>
          )}

          {phase === "failed" && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => setPhase("configure")}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PhaseStep - Visual indicator for BUILD/TEST/IMPROVE phase
 */
function PhaseStep({
  label,
  active,
  complete,
}: {
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
        complete
          ? "bg-primary text-primary-foreground"
          : active
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground"
      )}
    >
      {complete && <CheckCircle2 className="h-3 w-3" />}
      {active && !complete && <RefreshCw className="h-3 w-3 animate-spin" />}
      {label}
    </div>
  );
}
