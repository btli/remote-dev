"use client";

import { useState, useCallback } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { CRON_PRESETS, TIMEZONE_OPTIONS, type ScheduleCommandInput, type ScheduleType } from "@/types/schedule";
import type { TerminalSession } from "@/types/session";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Calendar, Repeat } from "lucide-react";

interface CreateScheduleModalProps {
  open: boolean;
  onClose: () => void;
  session: TerminalSession | null;
}

interface CommandRow extends ScheduleCommandInput {
  id: string; // For React key
}

export function CreateScheduleModal({
  open,
  onClose,
  session,
}: CreateScheduleModalProps) {
  const { createSchedule } = useScheduleContext();

  // Form state
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("one-time");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [cronPreset, setCronPreset] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [commands, setCommands] = useState<CommandRow[]>([
    { id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false },
  ]);

  // One-time schedule state - using Date object for the DateTimePicker
  const [scheduledDateTime, setScheduledDateTime] = useState<Date | undefined>(undefined);

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxRetries, setMaxRetries] = useState(3);
  const [retryDelaySeconds, setRetryDelaySeconds] = useState(30);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && session) {
        setName(`Schedule for ${session.name}`);
        setScheduleType("one-time");
        setCronExpression("0 9 * * *");
        setCronPreset("");
        setTimezone("America/Los_Angeles");
        setCommands([
          { id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false },
        ]);
        // Default to 1 hour from now for one-time schedules
        const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
        defaultTime.setSeconds(0);
        defaultTime.setMilliseconds(0);
        setScheduledDateTime(defaultTime);
        setShowAdvanced(false);
        setMaxRetries(3);
        setRetryDelaySeconds(30);
        setTimeoutSeconds(300);
        setError(null);
      }
      if (!isOpen) {
        onClose();
      }
    },
    [session, onClose]
  );

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
    // Name is only required for recurring schedules
    if (scheduleType === "recurring" && !name.trim()) {
      setError("Schedule name is required for recurring schedules");
      return false;
    }

    if (scheduleType === "one-time") {
      if (!scheduledDateTime) {
        setError("Date and time are required for one-time schedules");
        return false;
      }
      if (scheduledDateTime <= new Date()) {
        setError("Scheduled time must be in the future");
        return false;
      }
    } else {
      if (!cronExpression.trim()) {
        setError("Cron expression is required for recurring schedules");
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
    if (!session) return;
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

      // Build the schedule input based on type
      if (scheduleType === "one-time" && scheduledDateTime) {
        // Get ISO 8601 datetime string for one-time schedules
        const scheduledAt = scheduledDateTime.toISOString();

        // Auto-generate name if not provided
        const scheduleName = name.trim() ||
          `${scheduledDateTime.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} - ${validCommands[0].command.slice(0, 30)}${validCommands[0].command.length > 30 ? "..." : ""}`;

        await createSchedule({
          sessionId: session.id,
          name: scheduleName,
          scheduleType: "one-time",
          scheduledAt,
          timezone,
          commands: validCommands,
          enabled: true,
          maxRetries,
          retryDelaySeconds,
          timeoutSeconds,
        });
      } else {
        await createSchedule({
          sessionId: session.id,
          name: name.trim(),
          scheduleType: "recurring",
          cronExpression: cronExpression.trim(),
          timezone,
          commands: validCommands,
          enabled: true,
          maxRetries,
          retryDelaySeconds,
          timeoutSeconds,
        });
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    } finally {
      setIsSaving(false);
    }
  };

  // Format next run time preview
  const getNextRunPreview = (): string => {
    if (scheduleType === "one-time") {
      if (!scheduledDateTime) return "Select date and time";
      const now = new Date();
      if (scheduledDateTime <= now) return "Time is in the past";
      // Format as relative time
      const diffMs = scheduledDateTime.getTime() - now.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays > 0) return `In ${diffDays} day${diffDays > 1 ? "s" : ""}`;
      if (diffHours > 0) return `In ${diffHours} hour${diffHours > 1 ? "s" : ""}`;
      if (diffMins > 0) return `In ${diffMins} minute${diffMins > 1 ? "s" : ""}`;
      return "In less than a minute";
    }

    try {
      // Simple preview - in production we'd use croner to calculate this
      const preset = CRON_PRESETS.find((p) => p.value === cronExpression);
      if (preset) {
        return preset.description;
      }
      return `Cron: ${cronExpression}`;
    } catch {
      return "Invalid expression";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] bg-popover/95 backdrop-blur-xl border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Schedule Command
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Create a scheduled command for{" "}
            <span className="text-foreground font-medium">{session?.name || "session"}</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-140px)] pr-4">
          <div className="space-y-4 mt-3">
            {/* Schedule Name */}
            <div className="space-y-1.5">
              <Label htmlFor="schedule-name" className="text-xs text-muted-foreground">
                Schedule Name {scheduleType === "recurring" && "*"}
              </Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={scheduleType === "one-time" ? "Auto-generated if empty" : "Daily backup"}
                className="h-8 text-xs bg-card/50 border-border focus:border-primary"
              />
              {scheduleType === "one-time" && (
                <p className="text-[10px] text-muted-foreground/70">Optional for one-time commands</p>
              )}
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
                <TabsList className="grid w-full grid-cols-2 bg-card/50 h-8">
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
                </TabsList>
              </Tabs>

              {/* One-time Schedule: Date/Time Picker */}
              {scheduleType === "one-time" && (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date & Time *</Label>
                    <DateTimePicker
                      date={scheduledDateTime}
                      onDateChange={setScheduledDateTime}
                      minDate={new Date()}
                      placeholder="Select date and time"
                    />
                  </div>
                  <p className="text-[10px] text-primary/80">{getNextRunPreview()}</p>
                </div>
              )}

              {/* Recurring Schedule: Cron Expression */}
              {scheduleType === "recurring" && (
                <>
                  {/* Preset Selector */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Quick Presets</Label>
                    <Select value={cronPreset} onValueChange={handlePresetChange}>
                      <SelectTrigger className="h-8 text-xs bg-card/50 border-border">
                        <SelectValue placeholder="Select a preset..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CRON_PRESETS.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value} className="text-xs">
                            <div className="flex flex-col">
                              <span>{preset.label}</span>
                              <span className="text-[10px] text-muted-foreground/70">{preset.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cron Expression */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-expression" className="text-xs text-muted-foreground">
                      Cron Expression
                    </Label>
                    <Input
                      id="cron-expression"
                      value={cronExpression}
                      onChange={(e) => {
                        setCronExpression(e.target.value);
                        setCronPreset("");
                      }}
                      placeholder="0 9 * * *"
                      className="h-8 text-xs bg-card/50 border-border focus:border-primary font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground/70">
                      Format: minute hour day month weekday (e.g., &quot;0 9 * * *&quot; = 9 AM daily)
                    </p>
                    <p className="text-[10px] text-primary/80">{getNextRunPreview()}</p>
                  </div>
                </>
              )}

              {/* Timezone */}
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
                      {/* Reorder handle */}
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

                      {/* Command input */}
                      <div className="flex-1 space-y-1.5">
                        <Textarea
                          value={cmd.command}
                          onChange={(e) => updateCommand(cmd.id, { command: e.target.value })}
                          placeholder="npm run build"
                          className="min-h-[50px] text-xs bg-card/50 border-border focus:border-primary font-mono resize-none"
                        />

                        {/* Command options */}
                        <div className="flex flex-wrap items-center gap-3 text-[10px]">
                          {/* Delay before */}
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

                          {/* Continue on error */}
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

                      {/* Remove button */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeCommand(cmd.id)}
                        disabled={commands.length === 1}
                        className={cn(
                          "h-6 w-6 text-muted-foreground/70 hover:text-red-400 hover:bg-red-400/10",
                          commands.length === 1 && "opacity-30 cursor-not-allowed"
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
                {showAdvanced ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
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

            {/* Error message */}
            {error && <p className="text-xs text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
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
                    Creating...
                  </>
                ) : (
                  "Create Schedule"
                )}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
