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
import { CRON_PRESETS, TIMEZONE_OPTIONS, type ScheduleCommandInput } from "@/types/schedule";
import type { TerminalSession } from "@/types/session";

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
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [cronPreset, setCronPreset] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [commands, setCommands] = useState<CommandRow[]>([
    { id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false },
  ]);

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
        setCronExpression("0 9 * * *");
        setCronPreset("");
        setTimezone("America/Los_Angeles");
        setCommands([
          { id: crypto.randomUUID(), command: "", delayBeforeSeconds: 0, continueOnError: false },
        ]);
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

      await createSchedule({
        sessionId: session.id,
        name: name.trim(),
        cronExpression: cronExpression.trim(),
        timezone,
        commands: validCommands,
        enabled: true,
        maxRetries,
        retryDelaySeconds,
        timeoutSeconds,
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    } finally {
      setIsSaving(false);
    }
  };

  // Format next run time preview
  const getNextRunPreview = (): string => {
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
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-violet-400" />
            Schedule Command
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Create a scheduled command for{" "}
            <span className="text-white font-medium">{session?.name || "session"}</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-140px)] pr-4">
          <div className="space-y-5 mt-4">
            {/* Schedule Name */}
            <div className="space-y-2">
              <Label htmlFor="schedule-name" className="text-sm text-slate-300">
                Schedule Name *
              </Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Daily backup"
                className="bg-slate-800/50 border-white/10 focus:border-violet-500"
              />
            </div>

            {/* Timing Section */}
            <div className="space-y-3 p-4 rounded-lg bg-slate-800/30 border border-white/5">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-violet-400" />
                Timing
              </h4>

              {/* Preset Selector */}
              <div className="space-y-2">
                <Label className="text-sm text-slate-400">Quick Presets</Label>
                <Select value={cronPreset} onValueChange={handlePresetChange}>
                  <SelectTrigger className="bg-slate-800/50 border-white/10">
                    <SelectValue placeholder="Select a preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        <div className="flex flex-col">
                          <span>{preset.label}</span>
                          <span className="text-xs text-slate-500">{preset.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cron Expression */}
              <div className="space-y-2">
                <Label htmlFor="cron-expression" className="text-sm text-slate-400">
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
                  className="bg-slate-800/50 border-white/10 focus:border-violet-500 font-mono"
                />
                <p className="text-xs text-slate-500">
                  Format: minute hour day month weekday (e.g., &quot;0 9 * * *&quot; = 9 AM daily)
                </p>
                <p className="text-xs text-violet-400/80">{getNextRunPreview()}</p>
              </div>

              {/* Timezone */}
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
                  className="text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
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
                      {/* Reorder handle */}
                      <div className="flex flex-col gap-0.5 pt-2">
                        <button
                          onClick={() => moveCommand(index, index - 1)}
                          disabled={index === 0}
                          className={cn(
                            "p-0.5 rounded hover:bg-white/10 transition-colors",
                            index === 0 && "opacity-30 cursor-not-allowed"
                          )}
                        >
                          <ChevronUp className="w-3 h-3 text-slate-500" />
                        </button>
                        <GripVertical className="w-3 h-3 text-slate-600 mx-auto" />
                        <button
                          onClick={() => moveCommand(index, index + 1)}
                          disabled={index === commands.length - 1}
                          className={cn(
                            "p-0.5 rounded hover:bg-white/10 transition-colors",
                            index === commands.length - 1 && "opacity-30 cursor-not-allowed"
                          )}
                        >
                          <ChevronDown className="w-3 h-3 text-slate-500" />
                        </button>
                      </div>

                      {/* Command input */}
                      <div className="flex-1 space-y-2">
                        <Textarea
                          value={cmd.command}
                          onChange={(e) => updateCommand(cmd.id, { command: e.target.value })}
                          placeholder="npm run build"
                          className="min-h-[60px] bg-slate-800/50 border-white/10 focus:border-violet-500 font-mono text-sm resize-none"
                        />

                        {/* Command options */}
                        <div className="flex flex-wrap items-center gap-4 text-xs">
                          {/* Delay before */}
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

                          {/* Continue on error */}
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

                      {/* Remove button */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeCommand(cmd.id)}
                        disabled={commands.length === 1}
                        className={cn(
                          "h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-400/10",
                          commands.length === 1 && "opacity-30 cursor-not-allowed"
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
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
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

            {/* Error message */}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={onClose} className="text-slate-400">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
