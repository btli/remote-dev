"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import type { ScheduleExecution } from "@/types/schedule";

interface ExecutionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  scheduleId: string;
  scheduleName: string;
}

export function ExecutionHistoryModal({
  open,
  onClose,
  scheduleId,
  scheduleName,
}: ExecutionHistoryModalProps) {
  const { getExecutionHistory } = useScheduleContext();

  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!scheduleId) return;

    setLoading(true);
    setError(null);

    try {
      const history = await getExecutionHistory(scheduleId, 50);
      setExecutions(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [scheduleId, getExecutionHistory]);

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open, loadHistory]);

  const formatDateTime = (date: Date | string): string => {
    const d = new Date(date);
    return d.toLocaleString();
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-400" />;
      case "timeout":
        return <Clock className="w-4 h-4 text-amber-400" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge variant="outline" className="text-green-400 border-green-400/30">
            Success
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="text-xs">
            Failed
          </Badge>
        );
      case "timeout":
        return (
          <Badge variant="outline" className="text-amber-400 border-amber-400/30">
            Timeout
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-violet-400" />
              <DialogTitle className="text-xl font-semibold text-white">
                Execution History
              </DialogTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={loadHistory}
              disabled={loading}
              className="h-8 w-8 text-slate-400 hover:text-white"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
          </div>
          <DialogDescription className="text-slate-400 truncate">
            {scheduleName}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400">
              <p>{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadHistory}
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          ) : executions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <History className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm">No executions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {executions.map((execution) => (
                <ExecutionRow
                  key={execution.id}
                  execution={execution}
                  isExpanded={expandedId === execution.id}
                  onToggle={() =>
                    setExpandedId(expandedId === execution.id ? null : execution.id)
                  }
                  formatDateTime={formatDateTime}
                  formatDuration={formatDuration}
                  getStatusIcon={getStatusIcon}
                  getStatusBadge={getStatusBadge}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end pt-4 border-t border-white/5">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Execution Row Component
// =============================================================================

interface ExecutionRowProps {
  execution: ScheduleExecution;
  isExpanded: boolean;
  onToggle: () => void;
  formatDateTime: (date: Date | string) => string;
  formatDuration: (ms: number) => string;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusBadge: (status: string) => React.ReactNode;
}

function ExecutionRow({
  execution,
  isExpanded,
  onToggle,
  formatDateTime,
  formatDuration,
  getStatusIcon,
  getStatusBadge,
}: ExecutionRowProps) {
  return (
    <div className="rounded-lg bg-slate-800/50 overflow-hidden">
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-slate-800 transition-colors text-left"
      >
        {/* Status icon */}
        {getStatusIcon(execution.status)}

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white">
              {formatDateTime(execution.startedAt)}
            </span>
            {getStatusBadge(execution.status)}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 mt-0.5">
            <span>Duration: {formatDuration(execution.durationMs)}</span>
            <span>
              Commands: {execution.successCount}/{execution.commandCount}
            </span>
          </div>
        </div>

        {/* Expand/collapse */}
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 space-y-3">
          {/* Error message */}
          {execution.errorMessage && (
            <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 font-medium mb-1">Error</p>
              <p className="text-xs text-red-300 font-mono whitespace-pre-wrap">
                {execution.errorMessage}
              </p>
            </div>
          )}

          {/* Output */}
          {execution.output && (
            <div className="p-2 rounded bg-slate-900/50 border border-white/5">
              <p className="text-xs text-slate-400 font-medium mb-1">Output</p>
              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px] overflow-y-auto">
                {execution.output}
              </pre>
            </div>
          )}

          {/* Timing details */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span>Started: {formatDateTime(execution.startedAt)}</span>
            <span>Completed: {formatDateTime(execution.completedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
