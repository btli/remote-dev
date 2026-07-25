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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Plus,
  Trash2,
  Clock,
  Terminal,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Calendar,
  Repeat,
  TimerReset,
  BookmarkPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { CRON_PRESETS, TIMEZONE_OPTIONS, type ScheduleCommandInput, type ScheduleType } from "@/types/schedule";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { SaveScheduleTemplateDialog } from "./SaveScheduleTemplateDialog";

interface EditScheduleModalProps {
  open: boolean;
  onClose: () => void;
  scheduleId: string;
}

interface CommandRow extends ScheduleCommandInput {
  id: string;
}

type IntervalUnit = "minutes" | "hours" | "days";

const INTERVAL_UNIT_SECONDS: Record<IntervalUnit, number> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

function splitInterval(seconds: number): { value: number; unit: IntervalUnit } {
  if (seconds % 86_400 === 0) return { value: seconds / 86_400, unit: "days" };
  if (seconds % 3_600 === 0) return { value: seconds / 3_600, unit: "hours" };
  return { value: Math.max(1, seconds / 60), unit: "minutes" };
}

export function EditScheduleModal({ open, onClose, scheduleId }: EditScheduleModalProps) {
  const { getScheduleWithCommands, updateSchedule, refreshSchedules } = useScheduleContext();

  // Form state
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("recurring");
  const [cronExpression, setCronExpression] = useState("");
  const [cronPreset, setCronPreset] = useState("");
  const [scheduledDateTime, setScheduledDateTime] = useState<Date | undefined>();
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("hours");
  const [anchorDateTime, setAnchorDateTime] = useState<Date | undefined>();
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [enabled, setEnabled] = useState(true);

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryDelaySeconds, setRetryDelaySeconds] = useState(30);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  // Load schedule data
  const loadSchedule = useCallback(async () => {
    if (!scheduleId) return;

    setIsLoading(true);
    setError(null);

    try {
      const schedule = await getScheduleWithCommands(scheduleId);
      if (!schedule) {
        setError("Schedule not found");
        return;
      }

      setName(schedule.name);
      setScheduleType(schedule.scheduleType || "recurring");
      setCronExpression(schedule.cronExpression || "");
      setTimezone(schedule.timezone);
      setEnabled(schedule.enabled);
      setMaxRetries(schedule.maxRetries);
      setRetryDelaySeconds(schedule.retryDelaySeconds);
      setTimeoutSeconds(schedule.timeoutSeconds);

      // Parse scheduledAt for one-time schedules
      if (schedule.scheduledAt) {
        setScheduledDateTime(new Date(schedule.scheduledAt));
      } else {
        setScheduledDateTime(undefined);
      }
      if (schedule.intervalSeconds) {
        const interval = splitInterval(schedule.intervalSeconds);
        setIntervalValue(interval.value);
        setIntervalUnit(interval.unit);
      } else {
        setIntervalValue(1);
        setIntervalUnit("hours");
      }
      setAnchorDateTime(
        schedule.anchorAt ? new Date(schedule.anchorAt) : undefined
      );

      // Map commands
      const mappedCommands = schedule.commands.map((cmd) => ({
        id: cmd.id,
        command: cmd.command,
        delayBeforeSeconds: cmd.delayBeforeSeconds,
        continueOnError: cmd.continueOnError,
      }));

      setCommands(
        mappedCommands.length > 0
          ? mappedCommands
          : [{ id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false }]
      );

      // Check if matches a preset
      const preset = CRON_PRESETS.find((p) => p.value === schedule.cronExpression);
      if (preset) {
        setCronPreset(preset.value);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId, getScheduleWithCommands]);

  useEffect(() => {
    if (open) {
      loadSchedule();
    }
  }, [open, loadSchedule]);

  // Handle preset selection
  const handlePresetChange = (presetValue: string) => {
    setCronPreset(presetValue);
    const preset = CRON_PRESETS.find((p) => p.value === presetValue);
    if (preset) {
      setCronExpression(preset.value);
    }
  };

  // Command management
  const addCommand = () => {
    setCommands([
      ...commands,
      { id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false },
    ]);
  };

  const removeCommand = (id: string) => {
    if (commands.length > 1) {
      setCommands(commands.filter((c) => c.id !== id));
    }
  };

  const updateCommand = (id: string, updates: Partial<CommandRow>) => {
    setCommands(commands.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const moveCommand = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= commands.length) return;
    const newCommands = [...commands];
    const [moved] = newCommands.splice(fromIndex, 1);
    newCommands.splice(toIndex, 0, moved);
    setCommands(newCommands);
  };

  // Validation
  const validateForm = (): boolean => {
    if (scheduleType !== "one-time" && !name.trim()) {
      setError("Schedule name is required");
      return false;
    }
    if (scheduleType === "recurring") {
      if (!cronExpression.trim()) {
        setError("Cron expression is required for recurring schedules");
        return false;
      }
    } else if (scheduleType === "one-time") {
      if (!scheduledDateTime) {
        setError("Date and time are required for one-time schedules");
        return false;
      }
      if (isNaN(scheduledDateTime.getTime())) {
        setError("Invalid date/time format");
        return false;
      }
      if (scheduledDateTime <= new Date()) {
        setError("Scheduled time must be in the future");
        return false;
      }
    } else {
      const intervalSeconds = intervalValue * INTERVAL_UNIT_SECONDS[intervalUnit];
      if (
        !Number.isFinite(intervalValue) ||
        !Number.isInteger(intervalSeconds) ||
        intervalValue < 1 ||
        intervalSeconds > 30 * 86_400
      ) {
        setError("Interval must be between 1 minute and 30 days");
        return false;
      }
      if (!anchorDateTime || isNaN(anchorDateTime.getTime())) {
        setError("Starting time is required for interval schedules");
        return false;
      }
    }
    const validCommands = commands.filter((c) => c.command.trim());
    if (validCommands.length === 0) {
      setError("At least one command is required");
      return false;
    }
    return true;
  };

  // Save handler
  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    setError(null);

    try {
      const validCommands = commands
        .filter((c) => c.command.trim())
        .map(({ command, delayBeforeSeconds, continueOnError }) => ({
          command: command.trim(),
          delayBeforeSeconds: delayBeforeSeconds || 0,
          continueOnError: continueOnError || false,
        }));

      // Build update object based on schedule type
      let scheduleName = name.trim();

      // Auto-generate name for one-time schedules if not provided
      if (scheduleType === "one-time" && !scheduleName) {
        scheduleName = `${scheduledDateTime!.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} - ${validCommands[0].command.slice(0, 30)}${validCommands[0].command.length > 30 ? "..." : ""}`;
      }

      const updates: Record<string, unknown> = {
        name: scheduleName,
        scheduleType,
        timezone,
        enabled,
        maxRetries,
        retryDelaySeconds,
        timeoutSeconds,
      };

      if (scheduleType === "recurring") {
        updates.cronExpression = cronExpression.trim();
        updates.scheduledAt = null;
        updates.intervalSeconds = null;
        updates.anchorAt = null;
      } else if (scheduleType === "one-time") {
        updates.cronExpression = null;
        updates.scheduledAt = scheduledDateTime!.toISOString();
        updates.intervalSeconds = null;
        updates.anchorAt = null;
      } else {
        updates.cronExpression = null;
        updates.scheduledAt = null;
        updates.intervalSeconds =
          intervalValue * INTERVAL_UNIT_SECONDS[intervalUnit];
        updates.anchorAt = anchorDateTime!.toISOString();
      }

      await updateSchedule(scheduleId, updates, validCommands);

      await refreshSchedules();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update schedule");
    } finally {
      setIsSaving(false);
    }
  };

  const templateSnapshot = {
    scheduleType,
    cronExpression: scheduleType === "recurring" ? cronExpression.trim() : null,
    intervalSeconds:
      scheduleType === "interval"
        ? intervalValue * INTERVAL_UNIT_SECONDS[intervalUnit]
        : null,
    timezone,
    maxRetries,
    retryDelaySeconds,
    timeoutSeconds,
    commands: commands
      .filter((command) => command.command.trim())
      .map((command, order) => ({
        command: command.command.trim(),
        order,
        delayBeforeSeconds: command.delayBeforeSeconds ?? 0,
        continueOnError: command.continueOnError ?? false,
      })),
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Edit Schedule
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Modify the schedule configuration
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <ScrollArea className="max-h-[calc(85vh-140px)] pr-4">
            <div className="space-y-4 mt-3">
              {/* Schedule Name */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-schedule-name" className="text-xs text-muted-foreground">
                  Schedule Name {scheduleType !== "one-time" && "*"}
                </Label>
                <Input
                  id="edit-schedule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={scheduleType === "one-time" ? "Auto-generated if empty" : ""}
                  className="h-8 text-xs bg-card/50 border-border focus:border-primary"
                />
                {scheduleType === "one-time" && (
                  <p className="text-[10px] text-muted-foreground/70">Optional for one-time commands</p>
                )}
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-card/30">
                <Label className="text-xs text-muted-foreground">Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} className="scale-90" />
              </div>

              {/* Timing Section */}
              <div className="space-y-2.5 p-3 rounded-lg bg-card/30 border border-border">
                <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  Timing
                </h4>

                {/* Schedule Type Toggle */}
                <Tabs
                  value={scheduleType}
                  onValueChange={(value) => setScheduleType(value as ScheduleType)}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-3 bg-card/50 h-8">
                    <TabsTrigger
                      value="one-time"
                      className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      One-time
                    </TabsTrigger>
                    <TabsTrigger
                      value="recurring"
                      className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5"
                    >
                      <Repeat className="w-3.5 h-3.5" />
                      Recurring
                    </TabsTrigger>
                    <TabsTrigger
                      value="interval"
                      className="text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-1.5"
                    >
                      <TimerReset className="w-3.5 h-3.5" />
                      Interval
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* One-time Schedule: Date/Time Picker */}
                {scheduleType === "one-time" && (
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Date & Time *
                      </Label>
                      <DateTimePicker
                        date={scheduledDateTime}
                        onDateChange={setScheduledDateTime}
                        minDate={new Date()}
                        placeholder="Select date and time"
                      />
                    </div>
                  </div>
                )}

                {/* Recurring Schedule: Cron Expression */}
                {scheduleType === "recurring" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Quick Presets</Label>
                      <Select value={cronPreset} onValueChange={handlePresetChange}>
                        <SelectTrigger className="h-8 text-xs bg-card/50 border-border">
                          <SelectValue placeholder="Select a preset..." />
                        </SelectTrigger>
                        <SelectContent>
                          {CRON_PRESETS.map((preset) => (
                            <SelectItem key={preset.value} value={preset.value} className="text-xs">
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Cron Expression</Label>
                      <Input
                        value={cronExpression}
                        onChange={(e) => {
                          setCronExpression(e.target.value);
                          setCronPreset("");
                        }}
                        className="h-8 text-xs bg-card/50 border-border focus:border-primary font-mono"
                      />
                    </div>
                  </>
                )}

                {scheduleType === "interval" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Every N
                      </Label>
                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <Input
                          type="number"
                          step={1}
                          min={1}
                          max={
                            intervalUnit === "days"
                              ? 30
                              : intervalUnit === "hours"
                                ? 720
                                : 43_200
                          }
                          value={intervalValue}
                          onChange={(event) =>
                            setIntervalValue(Number(event.target.value))
                          }
                          className="h-8 text-xs bg-card/50 border-border"
                        />
                        <Select
                          value={intervalUnit}
                          onValueChange={(value) =>
                            setIntervalUnit(value as IntervalUnit)
                          }
                        >
                          <SelectTrigger className="h-8 text-xs bg-card/50 border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minutes">Minutes</SelectItem>
                            <SelectItem value="hours">Hours</SelectItem>
                            <SelectItem value="days">Days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Starting from *
                      </Label>
                      <DateTimePicker
                        date={anchorDateTime}
                        onDateChange={setAnchorDateTime}
                        placeholder="Select anchor date and time"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="h-8 text-xs bg-card/50 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value} className="text-xs">
                          {tz.label} ({tz.offset})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Commands Section */}
              <div className="space-y-2.5 p-3 rounded-lg bg-card/30 border border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-primary" />
                    Commands
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addCommand}
                    className="h-6 px-2 text-[10px] text-primary hover:text-primary/80 hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {commands.map((cmd, index) => (
                    <div
                      key={cmd.id}
                      className="p-2.5 rounded-lg bg-popover/50 border border-border space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col gap-0.5 pt-1.5">
                          <button
                            onClick={() => moveCommand(index, index - 1)}
                            disabled={index === 0}
                            className={cn(
                              "p-0.5 rounded hover:bg-accent transition-colors",
                              index === 0 && "opacity-30 cursor-not-allowed"
                            )}
                          >
                            <ChevronUp className="w-2.5 h-2.5 text-muted-foreground/70" />
                          </button>
                          <GripVertical className="w-2.5 h-2.5 text-muted-foreground/50 mx-auto" />
                          <button
                            onClick={() => moveCommand(index, index + 1)}
                            disabled={index === commands.length - 1}
                            className={cn(
                              "p-0.5 rounded hover:bg-accent transition-colors",
                              index === commands.length - 1 && "opacity-30 cursor-not-allowed"
                            )}
                          >
                            <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/70" />
                          </button>
                        </div>

                        <div className="flex-1 space-y-1.5">
                          <Textarea
                            value={cmd.command}
                            onChange={(e) => updateCommand(cmd.id, { command: e.target.value })}
                            className="min-h-[50px] text-xs bg-card/50 border-border font-mono resize-none"
                          />

                          <div className="flex flex-wrap items-center gap-3 text-[10px]">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-muted-foreground/70 text-[10px]">Wait</Label>
                              <Input
                                type="number"
                                min={0}
                                value={cmd.delayBeforeSeconds}
                                onChange={(e) =>
                                  updateCommand(cmd.id, {
                                    delayBeforeSeconds: parseInt(e.target.value) || 0,
                                  })
                                }
                                className="w-14 h-6 bg-card/50 border-border text-[10px]"
                              />
                              <span className="text-muted-foreground/70">sec</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={cmd.continueOnError}
                                onCheckedChange={(checked) =>
                                  updateCommand(cmd.id, { continueOnError: checked })
                                }
                                className="scale-[0.65]"
                              />
                              <Label className="text-muted-foreground/70 text-[10px]">Continue on error</Label>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeCommand(cmd.id)}
                          disabled={commands.length === 1}
                          className={cn(
                            "h-6 w-6 text-muted-foreground/70 hover:text-red-400 hover:bg-red-400/10",
                            commands.length === 1 && "opacity-30"
                          )}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Advanced Options */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Advanced Options
                </button>

                {showAdvanced && (
                  <div className="space-y-3 p-3 rounded-lg bg-card/30 border border-border">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Max Retries</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={maxRetries}
                          onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                          className="h-7 text-xs bg-card/50 border-border"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Retry Delay (s)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={retryDelaySeconds}
                          onChange={(e) => setRetryDelaySeconds(parseInt(e.target.value) || 0)}
                          className="h-7 text-xs bg-card/50 border-border"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Timeout (s)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={timeoutSeconds}
                          onChange={(e) => setTimeoutSeconds(parseInt(e.target.value) || 0)}
                          className="h-7 text-xs bg-card/50 border-border"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setSaveTemplateOpen(true)}
                  disabled={templateSnapshot.commands.length === 0}
                  className="mr-auto h-8 text-xs"
                >
                  <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                  Save as template
                </Button>
                <Button variant="ghost" onClick={onClose} className="h-8 text-xs text-muted-foreground">
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="h-8 text-xs bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
      {saveTemplateOpen && (
        <SaveScheduleTemplateDialog
          open
          onOpenChange={setSaveTemplateOpen}
          snapshot={templateSnapshot}
          suggestedName={name.trim()}
        />
      )}
    </Dialog>
  );
}
