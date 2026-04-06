"use client";

/**
 * SchedulesPanel - Schedule list content for the right sidebar.
 *
 * Displays session-scoped schedules with create/edit/toggle/run-now/delete
 * functionality. Rendered inside BeadsSidebar when the Schedules tab is active.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { useSessionContext } from "@/contexts/SessionContext";
import {
  Plus,
  Calendar,
  Repeat,
  Loader2,
  Trash2,
  Play,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateScheduleModal } from "@/components/schedule/CreateScheduleModal";
import { EditScheduleModal } from "@/components/schedule/EditScheduleModal";
import type { SessionScheduleWithSession } from "@/types/schedule";

// =============================================================================
// Helpers
// =============================================================================

function formatNextRun(date: Date | null): string {
  if (!date) return "Not scheduled";
  const d = new Date(date);
  const now = new Date();
  const diff = d.getTime() - now.getTime();

  if (diff < 0) return "Overdue";
  if (diff < 60000) return "< 1 min";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getScheduleStatusColor(
  schedule: SessionScheduleWithSession,
  isCompleted: boolean
): string {
  if (!schedule.enabled) return "text-muted-foreground";
  if (schedule.status === "failed") return "text-red-400";
  if (isCompleted) return "text-blue-400";
  return "text-primary";
}

// =============================================================================
// Sub-components
// =============================================================================

function ScheduleStatusLabel({
  schedule,
  isCompleted,
}: {
  schedule: SessionScheduleWithSession;
  isCompleted: boolean;
}) {
  if (isCompleted) {
    return <span className="text-[10px] text-blue-400">Completed</span>;
  }
  if (schedule.status === "failed") {
    return <span className="text-[10px] text-red-400">Failed</span>;
  }
  if (schedule.status === "paused" || !schedule.enabled) {
    return <span className="text-[10px] text-muted-foreground">Paused</span>;
  }
  return (
    <span className="text-[10px] text-muted-foreground">
      Next: {formatNextRun(schedule.nextRunAt)}
    </span>
  );
}

interface ScheduleItemProps {
  schedule: SessionScheduleWithSession;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  isRunning: boolean;
}

function ScheduleItem({
  schedule,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
  isRunning,
}: ScheduleItemProps) {
  const isOneTime = schedule.scheduleType === "one-time";
  const isCompleted = isOneTime && schedule.status === "completed";
  const statusColor = getScheduleStatusColor(schedule, isCompleted);
  const TypeIcon = isOneTime ? Calendar : Repeat;

  return (
    <div className="group px-2 py-1.5 rounded-md transition-all duration-150 hover:bg-accent/50">
      <div className="flex items-start gap-1.5">
        <TypeIcon
          className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", statusColor)}
        />

        <div className="flex-1 min-w-0">
          <button onClick={onEdit} className="w-full text-left">
            <span
              className={cn(
                "text-xs text-foreground line-clamp-1",
                !schedule.enabled && "opacity-50"
              )}
            >
              {schedule.name}
            </span>
          </button>

          <div className="flex items-center gap-1.5 mt-0.5">
            <ScheduleStatusLabel
              schedule={schedule}
              isCompleted={isCompleted}
            />
            <span className="text-[10px] text-muted-foreground/50 truncate">
              {schedule.session?.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
            className="scale-[0.55]"
          />

          <button
            onClick={onRunNow}
            disabled={isRunning}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-green-400"
          >
            {isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
          </button>

          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeleteScheduleDialogProps {
  open: boolean;
  scheduleName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function DeleteScheduleDialog({
  open,
  scheduleName,
  onConfirm,
  onClose,
}: DeleteScheduleDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">
            Delete Schedule
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs">
            Are you sure you want to delete{" "}
            <span className="text-foreground font-medium">
              &quot;{scheduleName}&quot;
            </span>
            ? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            size="sm"
            className="w-full text-xs"
            disabled={isDeleting}
            onClick={handleConfirm}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <AlertDialogCancel className="w-full text-xs" disabled={isDeleting}>
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// =============================================================================
// Main Panel
// =============================================================================

interface SchedulesPanelProps {
  /** Session ID to pre-select in CreateScheduleModal (from context menu trigger) */
  scheduleTargetSessionId?: string | null;
  /** Called after CreateScheduleModal opens to reset the trigger */
  onScheduleTargetConsumed?: () => void;
}

export function SchedulesPanel({
  scheduleTargetSessionId,
  onScheduleTargetConsumed,
}: SchedulesPanelProps) {
  const { schedules, toggleEnabled, deleteSchedule, executeNow } =
    useScheduleContext();
  const { sessions, activeSessionId } = useSessionContext();
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  // Modal state
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [createScheduleSessionId, setCreateScheduleSessionId] = useState<
    string | null
  >(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(
    null
  );

  // Open CreateScheduleModal when triggered from session context menu
  useEffect(() => {
    if (scheduleTargetSessionId) {
      setCreateScheduleSessionId(scheduleTargetSessionId);
      setCreateScheduleOpen(true);
      onScheduleTargetConsumed?.();
    }
  }, [scheduleTargetSessionId, onScheduleTargetConsumed]);

  const handleRunNow = useCallback(
    async (scheduleId: string) => {
      setRunningScheduleId(scheduleId);
      try {
        await executeNow(scheduleId);
      } finally {
        setRunningScheduleId(null);
      }
    },
    [executeNow]
  );

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Header row with create button */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="flex-1 text-xs font-medium text-muted-foreground">
              Schedules
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {schedules.length}
            </span>
            {activeSession && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setCreateScheduleOpen(true)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">New schedule</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Schedule list */}
          <div className="space-y-0.5 px-1">
            {!activeSession ? (
              <p className="text-[11px] text-muted-foreground px-3 py-2">
                Select a session to view schedules
              </p>
            ) : schedules.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-3 py-2">
                No schedules. Click + to create one.
              </p>
            ) : (
              schedules.map((schedule) => (
                <ScheduleItem
                  key={schedule.id}
                  schedule={schedule}
                  onEdit={() => setEditingScheduleId(schedule.id)}
                  onDelete={() =>
                    setDeleteTarget({ id: schedule.id, name: schedule.name })
                  }
                  onToggle={(enabled) => toggleEnabled(schedule.id, enabled)}
                  onRunNow={() => handleRunNow(schedule.id)}
                  isRunning={runningScheduleId === schedule.id}
                />
              ))
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Create Schedule Modal */}
      <CreateScheduleModal
        open={createScheduleOpen}
        onClose={() => {
          setCreateScheduleOpen(false);
          setCreateScheduleSessionId(null);
        }}
        session={
          createScheduleSessionId
            ? (sessions.find(
                (s) =>
                  s.id === createScheduleSessionId && s.status !== "closed"
              ) ?? null)
            : activeSession
        }
      />

      {/* Edit Schedule Modal */}
      {editingScheduleId && (
        <EditScheduleModal
          open
          onClose={() => setEditingScheduleId(null)}
          scheduleId={editingScheduleId}
        />
      )}

      {/* Delete Schedule Confirmation */}
      {deleteTarget && (
        <DeleteScheduleDialog
          open
          scheduleName={deleteTarget.name}
          onConfirm={() => deleteSchedule(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
