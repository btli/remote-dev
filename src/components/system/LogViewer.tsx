"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Terminal,
  Server,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { LogLevelValue } from "@/domain/value-objects/LogLevel";
import type { LogSource } from "@/application/ports/LogRepository";

interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevelValue;
  namespace: string;
  message: string;
  data: Record<string, unknown> | null;
  source: LogSource;
}

const LEVEL_STYLES: Record<LogLevelValue, string> = {
  error: "text-red-500",
  warn: "text-amber-500",
  info: "text-blue-400",
  debug: "text-purple-400",
  trace: "text-muted-foreground/60",
};

const LEVEL_BG: Record<LogLevelValue, string> = {
  error: "bg-red-500/10",
  warn: "bg-amber-500/10",
  info: "bg-blue-500/10",
  debug: "bg-purple-500/10",
  trace: "bg-muted/30",
};

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function LogViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [namespaceFilter, setNamespaceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadNamespaces = useCallback(async () => {
    try {
      const res = await fetch("/api/system/logs/namespaces");
      if (res.ok) {
        const data = await res.json();
        setNamespaces(data.namespaces ?? []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  const load = useCallback(
    async (opts: { before?: number; append?: boolean; isRefresh?: boolean } = {}) => {
      if (!opts.append) {
        if (opts.isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }
      setError(null);

      try {
        const params = new URLSearchParams({ limit: "150" });
        if (levelFilter !== "all") params.set("level", levelFilter);
        if (sourceFilter !== "all") params.set("source", sourceFilter);
        if (namespaceFilter !== "all") params.set("namespace", namespaceFilter);
        if (searchQuery.trim()) params.set("search", searchQuery.trim());
        if (opts.before) params.set("before", String(opts.before));

        const res = await fetch(`/api/system/logs?${params}`);
        if (!res.ok) throw new Error("Failed to fetch logs");
        const data: { entries: LogEntry[]; hasMore: boolean } = await res.json();

        setEntries((prev) => (opts.append ? [...prev, ...data.entries] : data.entries));
        setHasMore(data.hasMore);
      } catch {
        setError("Failed to load logs");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [levelFilter, sourceFilter, namespaceFilter, searchQuery]
  );

  useEffect(() => {
    load();
    loadNamespaces();
  }, [load, loadNamespaces]);

  // Auto-refresh every 3 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      load({ isRefresh: true });
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  const handleLoadMore = () => {
    const last = entries[entries.length - 1];
    if (last) {
      load({ before: new Date(last.timestamp).getTime(), append: true });
    }
  };

  const handleClear = async () => {
    setShowClearDialog(false);
    try {
      await fetch("/api/system/logs", { method: "DELETE" });
      setEntries([]);
      setHasMore(false);
      loadNamespaces();
    } catch {
      setError("Failed to clear logs");
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading logs...</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <Label className="text-foreground">Application Logs</Label>
          <div className="flex items-center gap-1">
            <Button
              variant={autoRefresh ? "default" : "ghost"}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh (3s)"}
              className="h-7 px-2 text-xs"
            >
              {autoRefresh ? "Live" : "Auto"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => load({ isRefresh: true })}
              disabled={refreshing}
              title="Refresh"
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClearDialog(true)}
              title="Clear all logs"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap shrink-0">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-7 text-xs bg-input border-border w-24">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              {["all", "error", "warn", "info", "debug", "trace"].map((l) => (
                <SelectItem key={l} value={l} className="text-xs">
                  {l === "all" ? "All levels" : l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-7 text-xs bg-input border-border w-28">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All sources</SelectItem>
              <SelectItem value="nextjs" className="text-xs">Next.js</SelectItem>
              <SelectItem value="terminal" className="text-xs">Terminal</SelectItem>
            </SelectContent>
          </Select>

          {namespaces.length > 0 && (
            <Select value={namespaceFilter} onValueChange={setNamespaceFilter}>
              <SelectTrigger className="h-7 text-xs bg-input border-border w-36">
                <SelectValue placeholder="Namespace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All namespaces</SelectItem>
                {namespaces.map((ns) => (
                  <SelectItem key={ns} value={ns} className="text-xs">
                    {ns}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="h-7 text-xs bg-input border-border flex-1 min-w-[120px]"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Log entries */}
        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden flex-1 min-h-0">
          <div className="h-full overflow-y-auto font-mono text-xs">
            {entries.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                No log entries found
              </div>
            ) : (
              entries.map((entry) => {
                const isExpanded = expandedIds.has(entry.id);
                return (
                  <div key={entry.id} className={cn("border-b border-border/40", LEVEL_BG[entry.level])}>
                    <div
                      className="flex items-start gap-1.5 px-2 py-1 hover:bg-muted/50 cursor-pointer"
                      onClick={() => entry.data && toggleExpand(entry.id)}
                    >
                      <span className="shrink-0 w-3 mt-0.5">
                        {entry.data && (
                          isExpanded
                            ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                            : <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        )}
                      </span>

                      {/* Timestamp */}
                      <span className="text-muted-foreground/60 shrink-0 w-[70px]" title={entry.timestamp}>
                        {formatTime(entry.timestamp)}
                      </span>

                      {/* Date (only show if different from today) */}
                      {new Date(entry.timestamp).toDateString() !== new Date().toDateString() && (
                        <span className="text-muted-foreground/40 shrink-0 w-12">
                          {formatDate(entry.timestamp)}
                        </span>
                      )}

                      {/* Level */}
                      <span className={cn("uppercase font-bold shrink-0 w-10", LEVEL_STYLES[entry.level])}>
                        {entry.level.slice(0, 5).padEnd(5)}
                      </span>

                      {/* Source icon */}
                      <span title={entry.source === "terminal" ? "Terminal server" : "Next.js server"}>
                        {entry.source === "terminal" ? (
                          <Terminal className="w-3 h-3 shrink-0 mt-0.5 text-green-500" />
                        ) : (
                          <Server className="w-3 h-3 shrink-0 mt-0.5 text-blue-400" />
                        )}
                      </span>

                      {/* Namespace */}
                      <span className="text-primary/70 shrink-0 max-w-[100px] truncate" title={entry.namespace}>
                        {entry.namespace}
                      </span>

                      {/* Message */}
                      <span className="text-foreground/80 min-w-0 break-words flex-1">
                        {entry.message}
                      </span>
                    </div>

                    {/* Expanded data */}
                    {isExpanded && entry.data && (
                      <div className="px-2 pb-2 pl-8">
                        <pre className="text-[10px] text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Load more */}
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs shrink-0"
            onClick={handleLoadMore}
          >
            Load more
          </Button>
        )}

        {/* Help text */}
        <p className="text-xs text-muted-foreground shrink-0">
          Logs are retained for 7 days. Set <code className="text-primary/70">LOG_LEVEL</code> env
          var to control verbosity (error/warn/info/debug/trace).
        </p>
      </div>

      {/* Clear confirmation */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all log entries. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear}>Clear All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
