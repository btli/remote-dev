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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleContext } from "@/contexts/ScheduleContext";
import { CRON_PRESETS, TIMEZONE_OPTIONS, type ScheduleCommandInput } from "@/types/schedule";

interface EditScheduleModalProps {
  open: boolean;
  onClose: () => void;
  scheduleId: string;
}

interface CommandRow extends ScheduleCommandInput {
  id: string;
}

export function EditScheduleModal({ open, onClose, scheduleId }: EditScheduleModalProps) {
  const { getScheduleWithCommands, updateSchedule, refreshSchedules } = useScheduleContext();

  // Form state
  const [name, setName] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [cronPreset, setCronPreset] = useState("");
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
      setCronExpression(schedule.cronExpression);
      setTimezone(schedule.timezone);
      setEnabled(schedule.enabled);
      setMaxRetries(schedule.maxRetries);
      setRetryDelaySeconds(schedule.retryDelaySeconds);
      setTimeoutSeconds(schedule.timeoutSeconds);

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
    if (!name.trim()) {
      setError("Schedule name is required");
      return false;
    }
    if (!cronExpression.trim()) {
      setError("Cron expression is required");
      return false;
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

      await updateSchedule(
        scheduleId,
        {
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          timezone,
          enabled,
          maxRetries,
          retryDelaySeconds,
          timeoutSeconds,
        },
        validCommands
      );

      await refreshSchedules();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update schedule");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-violet-400" />
            Edit Schedule
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Modify the schedule configuration
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          </div>
        ) : (
          <ScrollArea className="max-h-[calc(85vh-140px)] pr-4">
            <div className="space-y-5 mt-4">
              {/* Schedule Name */}
              <div className="space-y-2">
                <Label htmlFor="edit-schedule-name" className="text-sm text-slate-300">
                  Schedule Name *
                </Label>
                <Input
                  id="edit-schedule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500"
                />
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <Label className="text-sm text-slate-300">Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              {/* Timing Section */}
              <div className="space-y-3 p-4 rounded-lg bg-slate-800/30 border border-white/5">
                <h4 className="text-sm font-medium text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-violet-400" />
                  Timing
                </h4>

                <div className="space-y-2">
                  <Label className="text-sm text-slate-400">Quick Presets</Label>
                  <Select value={cronPreset} onValueChange={handlePresetChange}>
                    <SelectTrigger className="bg-slate-800/50 border-white/10">
                      <SelectValue placeholder="Select a preset..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CRON_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-slate-400">Cron Expression</Label>
                  <Input
                    value={cronExpression}
                    onChange={(e) => {
                      setCronExpression(e.target.value);
                      setCronPreset("");
                    }}
                    className="bg-slate-800/50 border-white/10 focus:border-violet-500 font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-slate-400">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="bg-slate-800/50 border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label} ({tz.offset})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Commands Section */}
              <div className="space-y-3 p-4 rounded-lg bg-slate-800/30 border border-white/5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-violet-400" />
                    Commands
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addCommand}
                    className="text-violet-400 hover:text-violet-300"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="space-y-3">
                  {commands.map((cmd, index) => (
                    <div
                      key={cmd.id}
                      className="p-3 rounded-lg bg-slate-900/50 border border-white/5 space-y-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col gap-0.5 pt-2">
                          <button
                            onClick={() => moveCommand(index, index - 1)}
                            disabled={index === 0}
                            className={cn(
                              "p-0.5 rounded hover:bg-white/10",
                              index === 0 && "opacity-30"
                            )}
                          >
                            <ChevronUp className="w-3 h-3 text-slate-500" />
                          </button>
                          <GripVertical className="w-3 h-3 text-slate-600 mx-auto" />
                          <button
                            onClick={() => moveCommand(index, index + 1)}
                            disabled={index === commands.length - 1}
                            className={cn(
                              "p-0.5 rounded hover:bg-white/10",
                              index === commands.length - 1 && "opacity-30"
                            )}
                          >
                            <ChevronDown className="w-3 h-3 text-slate-500" />
                          </button>
                        </div>

                        <div className="flex-1 space-y-2">
                          <Textarea
                            value={cmd.command}
                            onChange={(e) => updateCommand(cmd.id, { command: e.target.value })}
                            className="min-h-[60px] bg-slate-800/50 border-white/10 font-mono text-sm resize-none"
                          />

                          <div className="flex flex-wrap items-center gap-4 text-xs">
                            <div className="flex items-center gap-2">
                              <Label className="text-slate-500">Wait</Label>
                              <Input
                                type="number"
                                min={0}
                                value={cmd.delayBeforeSeconds}
                                onChange={(e) =>
                                  updateCommand(cmd.id, {
                                    delayBeforeSeconds: parseInt(e.target.value) || 0,
                                  })
                                }
                                className="w-16 h-7 bg-slate-800/50 border-white/10 text-xs"
                              />
                              <span className="text-slate-500">sec before</span>
                            </div>

                            <div className="flex items-center gap-2">
                              <Switch
                                checked={cmd.continueOnError}
                                onCheckedChange={(checked) =>
                                  updateCommand(cmd.id, { continueOnError: checked })
                                }
                                className="scale-75"
                              />
                              <Label className="text-slate-500">Continue on error</Label>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeCommand(cmd.id)}
                          disabled={commands.length === 1}
                          className={cn(
                            "h-7 w-7 text-slate-500 hover:text-red-400",
                            commands.length === 1 && "opacity-30"
                          )}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Advanced Options */}
              <div className="space-y-3">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300"
                >
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Advanced Options
                </button>

                {showAdvanced && (
                  <div className="space-y-4 p-4 rounded-lg bg-slate-800/30 border border-white/5">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm text-slate-400">Max Retries</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={maxRetries}
                          onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                          className="bg-slate-800/50 border-white/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-slate-400">Retry Delay (s)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={retryDelaySeconds}
                          onChange={(e) => setRetryDelaySeconds(parseInt(e.target.value) || 0)}
                          className="bg-slate-800/50 border-white/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-slate-400">Timeout (s)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={timeoutSeconds}
                          onChange={(e) => setTimeoutSeconds(parseInt(e.target.value) || 0)}
                          className="bg-slate-800/50 border-white/10"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={onClose} className="text-slate-400">
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
    </Dialog>
  );
}
