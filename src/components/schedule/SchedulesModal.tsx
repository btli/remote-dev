"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clock,
  MoreHorizontal,
  Play,
  Pencil,
  Trash2,
  History,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Calendar,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import type { SessionScheduleWithSession } from "@/types/schedule";
import { EditScheduleModal } from "./EditScheduleModal";
import { ExecutionHistoryModal } from "./ExecutionHistoryModal";

interface SchedulesModalProps {
  open: boolean;
  onClose: () => void;
}

export function SchedulesModal({ open, onClose }: SchedulesModalProps) {
  const {
    schedules,
    loading,
    error,
    refreshSchedules,
    toggleEnabled,
    deleteSchedule,
    executeNow,
  } = useScheduleContext();

  const [selectedSchedule, setSelectedSchedule] = useState<SessionScheduleWithSession | null>(
    null
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refresh on open
  useEffect(() => {
    if (open) {
      refreshSchedules();
    }
  }, [open, refreshSchedules]);

  const handleExecuteNow = async (schedule: SessionScheduleWithSession) => {
    setExecutingId(schedule.id);
    try {
      await executeNow(schedule.id);
      await refreshSchedules();
    } catch (err) {
      console.error("Failed to execute schedule:", err);
    } finally {
      setExecutingId(null);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;

    setDeletingId(scheduleId);
    try {
      await deleteSchedule(scheduleId);
    } catch (err) {
      console.error("Failed to delete schedule:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (schedule: SessionScheduleWithSession) => {
    setSelectedSchedule(schedule);
    setShowEditModal(true);
  };

  const handleHistory = (schedule: SessionScheduleWithSession) => {
    setSelectedSchedule(schedule);
    setShowHistoryModal(true);
  };

  const formatNextRun = (date: Date | null): string => {
    if (!date) return "Not scheduled";
    const d = new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();

    if (diff < 0) return "Overdue";
    if (diff < 60000) return "< 1 min";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours`;
    return d.toLocaleDateString();
  };

  const formatLastRun = (date: Date | null): string => {
    if (!date) return "Never";
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return d.toLocaleDateString();
  };

  const getStatusBadge = (schedule: SessionScheduleWithSession) => {
    // One-time schedule that has completed
    if (schedule.scheduleType === "one-time" && schedule.status === "completed") {
      return (
        <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    }
    if (schedule.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    }
    if (schedule.status === "paused") {
      return (
        <Badge variant="secondary" className="text-xs">
          <AlertCircle className="w-3 h-3 mr-1" />
          Paused
        </Badge>
      );
    }
    if (schedule.lastRunStatus === "success") {
      return (
        <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Success
        </Badge>
      );
    }
    if (schedule.lastRunStatus === "failed") {
      return (
        <Badge variant="outline" className="text-xs text-red-400 border-red-400/30">
          <XCircle className="w-3 h-3 mr-1" />
          Last failed
        </Badge>
      );
    }
    return null;
  };

  // Format scheduled time for one-time schedules
  const formatScheduledAt = (date: Date | null): string => {
    if (!date) return "Not set";
    const d = new Date(date);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-violet-400" />
                <DialogTitle className="text-xl font-semibold text-white">
                  Scheduled Commands
                </DialogTitle>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => refreshSchedules()}
                disabled={loading}
                className="h-8 w-8 text-slate-400 hover:text-white"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
            </div>
            <DialogDescription className="text-slate-400">
              Manage scheduled commands across all sessions
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(85vh-140px)]">
            {loading && schedules.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-400">
                <p>{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshSchedules()}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            ) : schedules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <Clock className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm">No scheduled commands</p>
                <p className="text-xs mt-1">
                  Right-click a session to create a schedule
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    isExecuting={executingId === schedule.id}
                    isDeleting={deletingId === schedule.id}
                    onToggleEnabled={(enabled) => toggleEnabled(schedule.id, enabled)}
                    onExecuteNow={() => handleExecuteNow(schedule)}
                    onEdit={() => handleEdit(schedule)}
                    onHistory={() => handleHistory(schedule)}
                    onDelete={() => handleDelete(schedule.id)}
                    formatNextRun={formatNextRun}
                    formatLastRun={formatLastRun}
                    formatScheduledAt={formatScheduledAt}
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

      {/* Edit Modal */}
      {selectedSchedule && (
        <EditScheduleModal
          open={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedSchedule(null);
          }}
          scheduleId={selectedSchedule.id}
        />
      )}

      {/* History Modal */}
      {selectedSchedule && (
        <ExecutionHistoryModal
          open={showHistoryModal}
          onClose={() => {
            setShowHistoryModal(false);
            setSelectedSchedule(null);
          }}
          scheduleId={selectedSchedule.id}
          scheduleName={selectedSchedule.name}
        />
      )}
    </>
  );
}

// =============================================================================
// Schedule Row Component
// =============================================================================

interface ScheduleRowProps {
  schedule: SessionScheduleWithSession;
  isExecuting: boolean;
  isDeleting: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onExecuteNow: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  formatNextRun: (date: Date | null) => string;
  formatLastRun: (date: Date | null) => string;
  formatScheduledAt: (date: Date | null) => string;
  getStatusBadge: (schedule: SessionScheduleWithSession) => React.ReactNode;
}

function ScheduleRow({
  schedule,
  isExecuting,
  isDeleting,
  onToggleEnabled,
  onExecuteNow,
  onEdit,
  onHistory,
  onDelete,
  formatNextRun,
  formatLastRun,
  formatScheduledAt,
  getStatusBadge,
}: ScheduleRowProps) {
  const isOneTime = schedule.scheduleType === "one-time";
  const isCompleted = isOneTime && schedule.status === "completed";
  return (
    <div
      className={cn(
        "group flex items-start gap-3 p-4 rounded-lg",
        "bg-slate-800/50 hover:bg-slate-800 transition-colors",
        isDeleting && "opacity-50"
      )}
    >
      {/* Enable/Disable toggle */}
      <div className="pt-0.5">
        <Switch
          checked={schedule.enabled}
          onCheckedChange={onToggleEnabled}
          disabled={isDeleting}
          className="scale-90"
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Schedule type icon */}
          {isOneTime ? (
            <Calendar className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          ) : (
            <Repeat className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          )}
          <h4 className="text-sm font-medium text-white truncate">{schedule.name}</h4>
          {getStatusBadge(schedule)}
        </div>

        {/* Session info */}
        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
          <Terminal className="w-3 h-3" />
          <span className="truncate">{schedule.session?.name || "Unknown session"}</span>
        </div>

        {/* Timing info */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
          {isOneTime ? (
            <span className="text-slate-400">
              <span className="text-slate-500">At:</span>{" "}
              <span className="text-violet-400">{formatScheduledAt(schedule.scheduledAt)}</span>
            </span>
          ) : (
            <span className="text-slate-400">
              <span className="text-slate-500">Cron:</span>{" "}
              <code className="bg-slate-700/50 px-1 py-0.5 rounded font-mono">
                {schedule.cronExpression}
              </code>
            </span>
          )}
          {!isCompleted && (
            <span className="text-slate-400">
              <span className="text-slate-500">Next:</span> {formatNextRun(schedule.nextRunAt)}
            </span>
          )}
          <span className="text-slate-400">
            <span className="text-slate-500">Last:</span> {formatLastRun(schedule.lastRunAt)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onExecuteNow}
          disabled={isExecuting || isDeleting}
          className="h-7 w-7 text-slate-400 hover:text-green-400 hover:bg-green-400/10"
          title="Run now"
        >
          {isExecuting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isDeleting}
              className="h-7 w-7 text-slate-400 hover:text-white"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>
              <History className="w-3.5 h-3.5 mr-2" />
              History
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
