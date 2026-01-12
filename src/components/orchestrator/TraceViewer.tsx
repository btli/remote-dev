"use client";

/**
 * TraceViewer - Visual trace viewer for tool call debugging
 *
 * Features:
 * - Timeline view of tool invocation sequence
 * - Call stack visualization showing tool chains
 * - Dependency graph for tool interactions
 * - Duration and success/failure indicators per call
 *
 * Based on arXiv 2512.10398v5 UX patterns for agent debugging.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Download,
  Search,
  ArrowRight,
  Layers,
  Activity,
  Box,
  Terminal,
  FileText,
  Code,
  Database,
  Globe,
  Wrench,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToolCallStatus = "pending" | "running" | "success" | "error" | "timeout";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: ToolCallStatus;
  startedAt: Date;
  completedAt?: Date;
  duration?: number; // ms
  parentId?: string; // For nested/chained calls
  sessionId?: string;
  /** Tool category for icon selection */
  category?: ToolCategory;
  /** Retry attempt number */
  attempt?: number;
  /** Related tool calls (dependencies) */
  dependencies?: string[];
}

export type ToolCategory =
  | "file"      // Read, Write, Edit, Glob
  | "shell"     // Bash, command execution
  | "search"    // Grep, web search
  | "code"      // Code analysis, AST tools
  | "database"  // DB operations
  | "network"   // HTTP, API calls
  | "other";

export interface TraceData {
  id: string;
  taskId?: string;
  sessionId?: string;
  calls: ToolCall[];
  startedAt: Date;
  completedAt?: Date;
  status: "running" | "completed" | "failed";
}

interface TraceViewerProps {
  /** Trace data to display */
  trace?: TraceData;
  /** Real-time streaming endpoint */
  streamEndpoint?: string;
  /** Enable real-time streaming */
  enableStreaming?: boolean;
  /** Mode: dialog, inline, or panel */
  mode?: "dialog" | "inline" | "panel";
  /** Trigger element for dialog mode */
  trigger?: React.ReactNode;
  /** Panel height for inline/panel mode */
  height?: string;
  /** Called when viewer is closed */
  onClose?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Config
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ToolCallStatus, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  label: string;
}> = {
  pending: {
    icon: Clock,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    label: "Pending",
  },
  running: {
    icon: Activity,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    label: "Running",
  },
  success: {
    icon: CheckCircle2,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    label: "Success",
  },
  error: {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Error",
  },
  timeout: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    label: "Timeout",
  },
};

const CATEGORY_ICONS: Record<ToolCategory, React.ElementType> = {
  file: FileText,
  shell: Terminal,
  search: Search,
  code: Code,
  database: Database,
  network: Globe,
  other: Wrench,
};

/**
 * Infer tool category from name
 */
function inferCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();

  if (["read", "write", "edit", "glob", "ls"].some((t) => name.includes(t))) {
    return "file";
  }
  if (["bash", "shell", "exec", "command"].some((t) => name.includes(t))) {
    return "shell";
  }
  if (["grep", "search", "find", "web"].some((t) => name.includes(t))) {
    return "search";
  }
  if (["code", "ast", "parse", "analyze"].some((t) => name.includes(t))) {
    return "code";
  }
  if (["db", "sql", "query", "database"].some((t) => name.includes(t))) {
    return "database";
  }
  if (["http", "fetch", "api", "request"].some((t) => name.includes(t))) {
    return "network";
  }

  return "other";
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format JSON for display
 */
function formatJson(obj: unknown, maxLength = 500): string {
  try {
    const str = JSON.stringify(obj, null, 2);
    if (str.length > maxLength) {
      return str.slice(0, maxLength) + "...";
    }
    return str;
  } catch {
    return String(obj);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline View Component
// ─────────────────────────────────────────────────────────────────────────────

interface TimelineViewProps {
  calls: ToolCall[];
  selectedId?: string;
  onSelect: (id: string) => void;
  zoom: number;
}

function TimelineView({ calls, selectedId, onSelect, zoom }: TimelineViewProps) {
  // For running calls without completedAt, use the latest call's startedAt as reference
  // This avoids calling Date.now() which is impure
  const getEffectiveEndTime = useCallback((call: ToolCall): number => {
    if (call.completedAt) {
      return call.completedAt.getTime();
    }
    // For running calls, estimate end time as startedAt + estimated duration
    // or just use startedAt + 1 second minimum width
    return call.startedAt.getTime() + (call.duration || 1000);
  }, []);

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
        <Activity className="h-12 w-12 mb-2" />
        <p className="font-medium">No tool calls yet</p>
        <p className="text-sm">Tool invocations will appear here</p>
      </div>
    );
  }

  // Calculate timeline bounds
  const startTime = Math.min(...calls.map((c) => c.startedAt.getTime()));
  const endTime = Math.max(...calls.map(getEffectiveEndTime));
  const totalDuration = endTime - startTime;

  // Base width per second (adjusted by zoom)
  const pixelsPerSecond = 50 * zoom;
  const timelineWidth = Math.max(800, (totalDuration / 1000) * pixelsPerSecond);

  return (
    <div className="relative overflow-x-auto">
      {/* Timeline header with time markers */}
      <div
        className="sticky top-0 z-10 h-6 bg-background border-b border-border"
        style={{ width: timelineWidth }}
      >
        {Array.from({ length: Math.ceil(totalDuration / 1000) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute text-[10px] text-muted-foreground"
            style={{ left: i * pixelsPerSecond }}
          >
            {i}s
          </div>
        ))}
      </div>

      {/* Tool call bars */}
      <div className="relative" style={{ width: timelineWidth, minHeight: calls.length * 32 }}>
        {calls.map((call, index) => {
          const status = STATUS_CONFIG[call.status];
          const StatusIcon = status.icon;
          const CategoryIcon = CATEGORY_ICONS[call.category || inferCategory(call.name)];

          const left = ((call.startedAt.getTime() - startTime) / 1000) * pixelsPerSecond;
          const duration = call.duration || (getEffectiveEndTime(call) - call.startedAt.getTime());
          const width = Math.max(20, (duration / 1000) * pixelsPerSecond);

          return (
            <Tooltip key={call.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "absolute h-6 rounded cursor-pointer transition-all",
                    "flex items-center gap-1 px-2 text-xs font-medium",
                    "border border-border hover:border-primary",
                    status.bgColor,
                    status.color,
                    selectedId === call.id && "ring-2 ring-primary"
                  )}
                  style={{
                    left,
                    top: index * 32 + 8,
                    width: Math.min(width, timelineWidth - left),
                  }}
                  onClick={() => onSelect(call.id)}
                >
                  <CategoryIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{call.name}</span>
                  <StatusIcon className="h-3 w-3 flex-shrink-0 ml-auto" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="text-xs">
                  <p className="font-medium">{call.name}</p>
                  <p className="text-muted-foreground">
                    {formatDuration(duration)} • {status.label}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Stack View Component
// ─────────────────────────────────────────────────────────────────────────────

interface CallStackViewProps {
  calls: ToolCall[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function CallStackView({ calls, selectedId, onSelect }: CallStackViewProps) {
  // Build tree structure from parent-child relationships
  const rootCalls = calls.filter((c) => !c.parentId);
  const childMap = new Map<string, ToolCall[]>();

  for (const call of calls) {
    if (call.parentId) {
      const children = childMap.get(call.parentId) || [];
      children.push(call);
      childMap.set(call.parentId, children);
    }
  }

  function renderCall(call: ToolCall, depth: number = 0): React.ReactNode {
    const children = childMap.get(call.id) || [];
    const status = STATUS_CONFIG[call.status];
    const StatusIcon = status.icon;
    const CategoryIcon = CATEGORY_ICONS[call.category || inferCategory(call.name)];

    return (
      <Collapsible key={call.id} defaultOpen={children.length > 0}>
        <div
          className={cn(
            "flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer",
            "hover:bg-muted/50 transition-colors",
            selectedId === call.id && "bg-muted"
          )}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onSelect(call.id)}
        >
          {children.length > 0 ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-4" />
          )}

          <CategoryIcon className={cn("h-4 w-4", status.color)} />

          <span className="font-medium text-sm flex-1 truncate">{call.name}</span>

          {call.duration && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              {formatDuration(call.duration)}
            </Badge>
          )}

          <StatusIcon className={cn("h-4 w-4", status.color)} />
        </div>

        {children.length > 0 && (
          <CollapsibleContent>
            {children.map((child) => renderCall(child, depth + 1))}
          </CollapsibleContent>
        )}
      </Collapsible>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
        <Layers className="h-12 w-12 mb-2" />
        <p className="font-medium">No call stack</p>
        <p className="text-sm">Tool chains will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {rootCalls.map((call) => renderCall(call))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Graph View Component
// ─────────────────────────────────────────────────────────────────────────────

interface DependencyGraphViewProps {
  calls: ToolCall[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

function DependencyGraphView({ calls, selectedId, onSelect }: DependencyGraphViewProps) {
  // Build dependency edges
  const edges: Array<{ from: string; to: string }> = [];

  for (const call of calls) {
    if (call.dependencies) {
      for (const depId of call.dependencies) {
        edges.push({ from: depId, to: call.id });
      }
    }
    if (call.parentId) {
      edges.push({ from: call.parentId, to: call.id });
    }
  }

  // Simple layout: arrange by start time
  const sortedCalls = [...calls].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
  );

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
        <GitBranch className="h-12 w-12 mb-2" />
        <p className="font-medium">No dependencies</p>
        <p className="text-sm">Tool interactions will appear here</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {/* Simple list view with arrows showing dependencies */}
      {sortedCalls.map((call, index) => {
        const status = STATUS_CONFIG[call.status];
        const StatusIcon = status.icon;
        const CategoryIcon = CATEGORY_ICONS[call.category || inferCategory(call.name)];

        // Find incoming edges
        const incomingEdges = edges.filter((e) => e.to === call.id);

        return (
          <div key={call.id} className="flex items-center gap-2">
            {/* Incoming arrows */}
            <div className="w-20 flex justify-end">
              {incomingEdges.length > 0 && (
                <div className="flex items-center gap-1">
                  {incomingEdges.slice(0, 3).map((edge, i) => (
                    <ArrowRight
                      key={i}
                      className="h-3 w-3 text-muted-foreground"
                    />
                  ))}
                  {incomingEdges.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{incomingEdges.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Node */}
            <div
              className={cn(
                "flex-1 flex items-center gap-2 p-2 rounded border cursor-pointer",
                "hover:bg-muted/50 transition-colors",
                status.bgColor,
                status.color,
                selectedId === call.id && "ring-2 ring-primary"
              )}
              onClick={() => onSelect(call.id)}
            >
              <CategoryIcon className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium text-sm truncate">{call.name}</span>
              {call.duration && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 ml-auto">
                  {formatDuration(call.duration)}
                </Badge>
              )}
              <StatusIcon className="h-4 w-4 flex-shrink-0" />
            </div>

            {/* Index */}
            <Badge variant="outline" className="text-[10px] w-6 justify-center">
              {index + 1}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Panel Component
// ─────────────────────────────────────────────────────────────────────────────

interface DetailPanelProps {
  call: ToolCall | null;
  onCopy: (text: string) => void;
}

function DetailPanel({ call, onCopy }: DetailPanelProps) {
  if (!call) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
        <Box className="h-12 w-12 mb-2" />
        <p className="font-medium">Select a tool call</p>
        <p className="text-sm">Details will appear here</p>
      </div>
    );
  }

  const status = STATUS_CONFIG[call.status];
  const StatusIcon = status.icon;
  const CategoryIcon = CATEGORY_ICONS[call.category || inferCategory(call.name)];

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CategoryIcon className={cn("h-5 w-5", status.color)} />
        <span className="font-semibold text-lg">{call.name}</span>
        <Badge className={cn("ml-auto", status.bgColor, status.color)}>
          <StatusIcon className="h-3 w-3 mr-1" />
          {status.label}
        </Badge>
      </div>

      {/* Timing */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Started:</span>
          <p className="font-mono text-xs">
            {call.startedAt.toLocaleTimeString()}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Duration:</span>
          <p className="font-mono text-xs">
            {call.duration ? formatDuration(call.duration) : "Running..."}
          </p>
        </div>
      </div>

      <Separator />

      {/* Input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium">Input</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onCopy(JSON.stringify(call.input, null, 2))}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40">
          {formatJson(call.input)}
        </pre>
      </div>

      {/* Output or Error */}
      {call.status === "success" && call.output !== undefined && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Output</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCopy(JSON.stringify(call.output, null, 2))}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40">
            {formatJson(call.output)}
          </pre>
        </div>
      )}

      {call.status === "error" && call.error && (
        <div>
          <span className="text-sm font-medium text-red-400">Error</span>
          <pre className="text-xs bg-red-500/10 text-red-400 p-2 rounded overflow-x-auto max-h-40">
            {call.error}
          </pre>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>ID: {call.id}</p>
        {call.sessionId && <p>Session: {call.sessionId}</p>}
        {call.parentId && <p>Parent: {call.parentId}</p>}
        {call.attempt && call.attempt > 1 && (
          <p>Attempt: {call.attempt}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main TraceViewer Component
// ─────────────────────────────────────────────────────────────────────────────

export function TraceViewer({
  trace,
  streamEndpoint,
  enableStreaming = false,
  mode = "dialog",
  trigger,
  height = "600px",
  onClose,
}: TraceViewerProps) {
  // State for streaming mode - maintains mutable call list
  const [streamingCalls, setStreamingCalls] = useState<ToolCall[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"timeline" | "stack" | "graph">("timeline");
  const [zoom, setZoom] = useState(1);
  const [isStreaming, setIsStreaming] = useState(enableStreaming);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Refs
  const eventSourceRef = useRef<EventSource | null>(null);

  // Derive calls from either trace prop (static) or streaming state (live)
  // This avoids syncing props to state which causes cascading renders
  const calls = isStreaming && streamingCalls.length > 0
    ? streamingCalls
    : (trace?.calls || []);

  // SSE streaming connection
  useEffect(() => {
    if (!isStreaming || !streamEndpoint) return;

    const eventSource = new EventSource(streamEndpoint);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "tool_call") {
          const toolCall: ToolCall = {
            ...data.data,
            startedAt: new Date(data.data.startedAt),
            completedAt: data.data.completedAt ? new Date(data.data.completedAt) : undefined,
          };

          setStreamingCalls((prev) => {
            // Update existing or add new
            const existingIndex = prev.findIndex((c) => c.id === toolCall.id);
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = toolCall;
              return next;
            }
            return [...prev, toolCall];
          });
        }
      } catch (error) {
        console.error("Failed to parse trace event:", error);
      }
    };

    eventSource.onerror = () => {
      console.warn("Trace stream disconnected");
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [isStreaming, streamEndpoint]);

  // Filter calls by search
  const filteredCalls = useMemo(() => {
    if (!searchQuery) return calls;

    const query = searchQuery.toLowerCase();
    return calls.filter(
      (call) =>
        call.name.toLowerCase().includes(query) ||
        call.id.toLowerCase().includes(query) ||
        JSON.stringify(call.input).toLowerCase().includes(query)
    );
  }, [calls, searchQuery]);

  // Selected call
  const selectedCall = useMemo(
    () => calls.find((c) => c.id === selectedId) || null,
    [calls, selectedId]
  );

  // Stats
  const stats = useMemo(() => {
    const total = calls.length;
    const success = calls.filter((c) => c.status === "success").length;
    const error = calls.filter((c) => c.status === "error").length;
    const running = calls.filter((c) => c.status === "running").length;
    const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);

    return { total, success, error, running, totalDuration };
  }, [calls]);

  // Handlers
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(calls, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [calls]);

  // Content
  const content = (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-background/50">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tool calls..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
          />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">
            <Activity className="h-3 w-3 mr-1" />
            {stats.total} calls
          </Badge>
          {stats.running > 0 && (
            <Badge variant="outline" className="text-blue-400">
              <Play className="h-3 w-3 mr-1" />
              {stats.running}
            </Badge>
          )}
          <Badge variant="outline" className="text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {stats.success}
          </Badge>
          {stats.error > 0 && (
            <Badge variant="outline" className="text-red-400">
              <XCircle className="h-3 w-3 mr-1" />
              {stats.error}
            </Badge>
          )}
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            {formatDuration(stats.totalDuration)}
          </Badge>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Zoom controls (timeline only) */}
        {activeTab === "timeline" && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                >
                  <ZoomOut className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out</TooltipContent>
            </Tooltip>

            <span className="text-xs text-muted-foreground w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                >
                  <ZoomIn className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="h-6" />
          </>
        )}

        {/* Streaming toggle */}
        {enableStreaming && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isStreaming ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => setIsStreaming(!isStreaming)}
              >
                {isStreaming ? (
                  <Pause className="h-3 w-3 mr-1" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                {isStreaming ? "Pause" : "Resume"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isStreaming ? "Pause streaming" : "Resume streaming"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Export */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleExport}
            >
              <Download className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export trace as JSON</TooltipContent>
        </Tooltip>
      </div>

      {/* Main content with tabs */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Views */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            className="flex-1 flex flex-col"
          >
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-9 px-2">
              <TabsTrigger value="timeline" className="text-xs">
                <Activity className="h-3 w-3 mr-1" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="stack" className="text-xs">
                <Layers className="h-3 w-3 mr-1" />
                Call Stack
              </TabsTrigger>
              <TabsTrigger value="graph" className="text-xs">
                <GitBranch className="h-3 w-3 mr-1" />
                Dependencies
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="flex-1 m-0 p-0">
              <ScrollArea className="h-full">
                <TimelineView
                  calls={filteredCalls}
                  selectedId={selectedId || undefined}
                  onSelect={setSelectedId}
                  zoom={zoom}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="stack" className="flex-1 m-0 p-0">
              <ScrollArea className="h-full">
                <CallStackView
                  calls={filteredCalls}
                  selectedId={selectedId || undefined}
                  onSelect={setSelectedId}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="graph" className="flex-1 m-0 p-0">
              <ScrollArea className="h-full">
                <DependencyGraphView
                  calls={filteredCalls}
                  selectedId={selectedId || undefined}
                  onSelect={setSelectedId}
                />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right panel: Details */}
        <div className="w-80 flex-shrink-0">
          <ScrollArea className="h-full">
            <DetailPanel call={selectedCall} onCopy={handleCopy} />
          </ScrollArea>
        </div>
      </div>
    </div>
  );

  // Render based on mode
  if (mode === "dialog") {
    return (
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) onClose?.();
        }}
      >
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <Activity className="h-4 w-4 mr-2" />
              View Trace
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-w-6xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Tool Call Trace
              {trace?.taskId && (
                <Badge variant="outline" className="text-xs">
                  Task: {trace.taskId.slice(0, 8)}...
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  // Inline or panel mode
  return (
    <div
      className="flex flex-col border border-border rounded-lg overflow-hidden bg-background"
      style={{ height: mode === "panel" ? height : undefined }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="font-medium text-sm">Tool Call Trace</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      {content}
    </div>
  );
}

export default TraceViewer;
