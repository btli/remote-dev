"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileText,
  Search,
  Filter,
  Download,
  Trash2,
  Play,
  Pause,
  Terminal,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Clock,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "agent" | "system" | "command" | "output" | "user";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
  /** Optional session ID */
  sessionId?: string;
  /** Optional command that generated this output */
  command?: string;
  /** Duration in ms if this is a timed operation */
  duration?: number;
}

interface LogViewerProps {
  /** Session ID to filter logs (optional) */
  sessionId?: string;
  /** Title for the log viewer */
  title?: string;
  /** Initial logs to display */
  initialLogs?: LogEntry[];
  /** Enable real-time streaming via SSE */
  enableStreaming?: boolean;
  /** API endpoint for streaming logs */
  streamEndpoint?: string;
  /** Maximum logs to keep in memory */
  maxLogs?: number;
  /** Show as dialog or inline */
  mode?: "dialog" | "inline" | "panel";
  /** Trigger element for dialog mode */
  trigger?: React.ReactNode;
  /** Panel height for inline/panel mode */
  height?: string;
  /** Called when log viewer is closed */
  onClose?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

const LOG_LEVEL_CONFIG: Record<LogLevel, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  label: string;
}> = {
  debug: {
    icon: Bug,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    label: "DEBUG",
  },
  info: {
    icon: Info,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    label: "INFO",
  },
  warn: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    label: "WARN",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "ERROR",
  },
};

const SOURCE_CONFIG: Record<LogSource, {
  icon: React.ElementType;
  label: string;
  color: string;
}> = {
  agent: { icon: Cpu, label: "Agent", color: "text-purple-400" },
  system: { icon: Info, label: "System", color: "text-cyan-400" },
  command: { icon: Terminal, label: "Command", color: "text-green-400" },
  output: { icon: FileText, label: "Output", color: "text-gray-400" },
  user: { icon: ExternalLink, label: "User", color: "text-orange-400" },
};

/**
 * Format JSON for display with syntax highlighting
 */
function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Check if a string is likely JSON
 */
function isJsonString(str: string): boolean {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

/**
 * Format message for display, handling JSON and tables
 */
function formatMessage(message: string): React.ReactNode {
  // Check if the message is JSON
  if (isJsonString(message)) {
    try {
      const parsed = JSON.parse(message);
      return (
        <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto max-w-full">
          {formatJson(parsed)}
        </pre>
      );
    } catch {
      // Not valid JSON, continue
    }
  }

  // Check if the message looks like a table (has | separators)
  if (message.includes("|") && message.split("\n").length > 1) {
    const lines = message.split("\n");
    const tableLines = lines.filter((line) => line.includes("|"));
    if (tableLines.length >= 2) {
      return (
        <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto font-mono">
          {message}
        </pre>
      );
    }
  }

  // Check for multi-line output (likely command output)
  if (message.split("\n").length > 3) {
    return (
      <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto max-h-48">
        {message}
      </pre>
    );
  }

  // Regular message
  return <span className="break-words">{message}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Entry Component
// ─────────────────────────────────────────────────────────────────────────────

interface LogEntryRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
}

function LogEntryRow({ entry, isExpanded, onToggle, onCopy }: LogEntryRowProps) {
  const levelConfig = LOG_LEVEL_CONFIG[entry.level];
  const sourceConfig = SOURCE_CONFIG[entry.source];
  const LevelIcon = levelConfig.icon;
  const SourceIcon = sourceConfig.icon;

  const hasMetadata = entry.metadata && Object.keys(entry.metadata).length > 0;
  const isExpandable = hasMetadata || entry.message.length > 150;

  return (
    <div
      className={cn(
        "group border-b border-border/50 hover:bg-muted/30 transition-colors",
        levelConfig.bgColor
      )}
    >
      <div
        className={cn(
          "flex items-start gap-2 px-3 py-2",
          isExpandable && "cursor-pointer"
        )}
        onClick={isExpandable ? onToggle : undefined}
      >
        {/* Expand indicator */}
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
          {isExpandable ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : null}
        </div>

        {/* Timestamp */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground font-mono flex-shrink-0 w-20">
              {entry.timestamp.toLocaleTimeString()}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {entry.timestamp.toLocaleString()}
            <br />
            {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
          </TooltipContent>
        </Tooltip>

        {/* Level badge */}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 h-4 flex-shrink-0",
            levelConfig.color,
            levelConfig.bgColor
          )}
        >
          <LevelIcon className="h-2.5 w-2.5 mr-0.5" />
          {levelConfig.label}
        </Badge>

        {/* Source badge */}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0 h-4 flex-shrink-0",
            sourceConfig.color
          )}
        >
          <SourceIcon className="h-2.5 w-2.5 mr-0.5" />
          {sourceConfig.label}
        </Badge>

        {/* Duration if present */}
        {entry.duration !== undefined && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0">
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            {entry.duration}ms
          </Badge>
        )}

        {/* Message (truncated) */}
        <div className="flex-1 min-w-0 text-sm">
          {isExpandable && !isExpanded ? (
            <span className="text-foreground truncate block">
              {entry.message.slice(0, 150)}...
            </span>
          ) : (
            formatMessage(entry.message)
          )}
        </div>

        {/* Copy button (visible on hover) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-10 pb-3 space-y-2">
          {/* Full message if truncated above */}
          {entry.message.length > 150 && (
            <div className="text-sm">{formatMessage(entry.message)}</div>
          )}

          {/* Command if present */}
          {entry.command && (
            <div className="text-xs">
              <span className="text-muted-foreground">Command: </span>
              <code className="bg-muted px-1 rounded">{entry.command}</code>
            </div>
          )}

          {/* Metadata */}
          {hasMetadata && (
            <div className="text-xs space-y-1">
              <span className="text-muted-foreground font-medium">Metadata:</span>
              <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
                {formatJson(entry.metadata)}
              </pre>
            </div>
          )}

          {/* Session ID if present */}
          {entry.sessionId && (
            <div className="text-xs text-muted-foreground">
              <Terminal className="h-3 w-3 inline mr-1" />
              Session: {entry.sessionId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main LogViewer Component
// ─────────────────────────────────────────────────────────────────────────────

export function LogViewer({
  sessionId,
  title = "Execution Logs",
  initialLogs = [],
  enableStreaming = false,
  streamEndpoint,
  maxLogs = 1000,
  mode = "dialog",
  trigger,
  height = "500px",
  onClose,
}: LogViewerProps) {
  // State
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [isStreaming, setIsStreaming] = useState(enableStreaming);
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<LogSource | "all">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Toggle entry expansion
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Copy log entry to clipboard
  const copyEntry = useCallback((entry: LogEntry) => {
    const text = JSON.stringify(entry, null, 2);
    navigator.clipboard.writeText(text);
  }, []);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (levelFilter !== "all" && log.level !== levelFilter) {
        return false;
      }

      // Source filter
      if (sourceFilter !== "all" && log.source !== sourceFilter) {
        return false;
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matches =
          log.message.toLowerCase().includes(query) ||
          log.command?.toLowerCase().includes(query) ||
          JSON.stringify(log.metadata || {})
            .toLowerCase()
            .includes(query);
        if (!matches) return false;
      }

      return true;
    });
  }, [logs, levelFilter, sourceFilter, searchQuery]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  // SSE streaming connection
  useEffect(() => {
    if (!isStreaming || !streamEndpoint) return;

    const eventSource = new EventSource(streamEndpoint);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const logEntry = JSON.parse(event.data) as LogEntry;
        logEntry.timestamp = new Date(logEntry.timestamp);

        setLogs((prev) => {
          const next = [...prev, logEntry];
          // Keep only the last maxLogs entries
          if (next.length > maxLogs) {
            return next.slice(-maxLogs);
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to parse log event:", error);
      }
    };

    eventSource.onerror = () => {
      console.warn("Log stream disconnected, attempting to reconnect...");
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [isStreaming, streamEndpoint, maxLogs]);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
    setExpandedIds(new Set());
  }, []);

  // Export logs as JSON
  const exportLogs = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  // Log counts by level
  const logCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    for (const log of logs) {
      counts[log.level]++;
    }
    return counts;
  }, [logs]);

  // Toolbar component
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-background/50">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8"
        />
      </div>

      {/* Level filter */}
      <Select
        value={levelFilter}
        onValueChange={(v) => setLevelFilter(v as typeof levelFilter)}
      >
        <SelectTrigger className="w-[120px] h-8">
          <Filter className="h-3 w-3 mr-1" />
          <SelectValue placeholder="Level" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Levels</SelectItem>
          <SelectItem value="debug">Debug ({logCounts.debug})</SelectItem>
          <SelectItem value="info">Info ({logCounts.info})</SelectItem>
          <SelectItem value="warn">Warn ({logCounts.warn})</SelectItem>
          <SelectItem value="error">Error ({logCounts.error})</SelectItem>
        </SelectContent>
      </Select>

      {/* Source filter */}
      <Select
        value={sourceFilter}
        onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}
      >
        <SelectTrigger className="w-[120px] h-8">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="agent">Agent</SelectItem>
          <SelectItem value="system">System</SelectItem>
          <SelectItem value="command">Command</SelectItem>
          <SelectItem value="output">Output</SelectItem>
          <SelectItem value="user">User</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="h-6" />

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
            {isStreaming ? "Pause log streaming" : "Resume log streaming"}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Auto-scroll toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            Auto-scroll
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6" />

      {/* Export */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={exportLogs}>
            <Download className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export logs as JSON</TooltipContent>
      </Tooltip>

      {/* Clear */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={clearLogs}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Clear all logs</TooltipContent>
      </Tooltip>

      {/* Log count */}
      <div className="text-xs text-muted-foreground">
        {filteredLogs.length} / {logs.length} logs
      </div>
    </div>
  );

  // Log list component
  const logList = (
    <ScrollArea
      className="flex-1"
      style={{ height: mode === "inline" ? height : undefined }}
      ref={scrollRef}
    >
      {filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mb-2" />
          <p className="font-medium">No logs to display</p>
          <p className="text-sm">
            {searchQuery || levelFilter !== "all" || sourceFilter !== "all"
              ? "Try adjusting your filters"
              : "Logs will appear here"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {filteredLogs.map((log) => (
            <LogEntryRow
              key={log.id}
              entry={log}
              isExpanded={expandedIds.has(log.id)}
              onToggle={() => toggleExpanded(log.id)}
              onCopy={() => copyEntry(log)}
            />
          ))}
        </div>
      )}
    </ScrollArea>
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
              <FileText className="h-4 w-4 mr-2" />
              View Logs
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {title}
              {sessionId && (
                <Badge variant="outline" className="text-xs">
                  Session: {sessionId.slice(0, 8)}...
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {toolbar}
          {logList}
        </DialogContent>
      </Dialog>
    );
  }

  // Inline or panel mode
  return (
    <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="font-medium text-sm">{title}</span>
          {sessionId && (
            <Badge variant="outline" className="text-xs">
              {sessionId.slice(0, 8)}...
            </Badge>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      {toolbar}
      {logList}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to create log entries
// ─────────────────────────────────────────────────────────────────────────────

let logIdCounter = 0;

export function createLogEntry(
  level: LogLevel,
  source: LogSource,
  message: string,
  options?: Partial<Omit<LogEntry, "id" | "timestamp" | "level" | "source" | "message">>
): LogEntry {
  return {
    id: `log-${Date.now()}-${logIdCounter++}`,
    timestamp: new Date(),
    level,
    source,
    message,
    ...options,
  };
}

export default LogViewer;
