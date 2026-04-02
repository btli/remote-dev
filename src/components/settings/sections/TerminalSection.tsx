"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import { SHELL_OPTIONS } from "@/lib/terminal-options";

export function TerminalSection() {
  const { userSettings, updateUserSettings } = usePreferencesContext();

  // Don't render controls until settings are loaded to avoid stale defaults
  if (!userSettings) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <TerminalSectionInner userSettings={userSettings} updateUserSettings={updateUserSettings} />;
}

function TerminalSectionInner({ userSettings, updateUserSettings }: {
  userSettings: NonNullable<ReturnType<typeof usePreferencesContext>["userSettings"]>;
  updateUserSettings: ReturnType<typeof usePreferencesContext>["updateUserSettings"];
}) {
  // Local state for input fields (saved on blur)
  const [workingDirectory, setWorkingDirectory] = useState(
    userSettings.defaultWorkingDirectory ?? ""
  );
  const [startupCommand, setStartupCommand] = useState(
    userSettings.startupCommand ?? ""
  );

  // Local state for sliders (saved on debounced change)
  const [xtermScrollback, setXtermScrollback] = useState(
    userSettings.xtermScrollback ?? 10000
  );
  const [tmuxHistoryLimit, setTmuxHistoryLimit] = useState(
    userSettings.tmuxHistoryLimit ?? 50000
  );

  const debouncedSave = useDebouncedSave(updateUserSettings);

  return (
    <div className="space-y-4">
      {/* Working Directory */}
      <div className="space-y-2">
        <Label className="text-foreground">Default Working Directory</Label>
        <Input
          value={workingDirectory}
          onChange={(e) => setWorkingDirectory(e.target.value)}
          onBlur={() =>
            updateUserSettings({
              defaultWorkingDirectory: workingDirectory || null,
            })
          }
          placeholder="~/projects"
          className="bg-input border-border text-foreground placeholder:text-muted-foreground"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use your home directory
        </p>
      </div>

      {/* Shell */}
      <div className="space-y-2">
        <Label className="text-foreground">Default Shell</Label>
        <Select
          value={userSettings?.defaultShell ?? "/bin/bash"}
          onValueChange={(value) => updateUserSettings({ defaultShell: value })}
        >
          <SelectTrigger className="bg-input border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {SHELL_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-popover-foreground focus:bg-primary/20"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Startup Command */}
      <div className="space-y-2">
        <Label className="text-foreground">Startup Command</Label>
        <Input
          value={startupCommand}
          onChange={(e) => setStartupCommand(e.target.value)}
          onBlur={() =>
            updateUserSettings({
              startupCommand: startupCommand || null,
            })
          }
          placeholder="claude"
          className="bg-input border-border text-foreground placeholder:text-muted-foreground"
        />
        <p className="text-xs text-muted-foreground">
          Command to run when a new session starts (e.g., claude, clauded)
        </p>
      </div>

      {/* Scrollback Buffer Settings */}
      <div className="pt-4 border-t border-border">
        <Label className="text-foreground text-sm font-medium">
          Scrollback Buffer
        </Label>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Reduce these values if you experience performance issues with
          long-running sessions. Changes apply to new sessions only.
        </p>

        {/* xterm.js Scrollback */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-foreground text-sm">
              Terminal (xterm.js)
            </Label>
            <span className="text-sm text-muted-foreground">
              {xtermScrollback.toLocaleString()} lines
            </span>
          </div>
          <Slider
            value={[xtermScrollback]}
            onValueChange={([value]) => {
              setXtermScrollback(value);
              debouncedSave("xtermScrollback", value);
            }}
            min={1000}
            max={50000}
            step={1000}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Client-side scrollback buffer for the terminal display
          </p>
        </div>

        {/* tmux History Limit */}
        <div className="space-y-2 mt-4">
          <div className="flex items-center justify-between">
            <Label className="text-foreground text-sm">Server (tmux)</Label>
            <span className="text-sm text-muted-foreground">
              {tmuxHistoryLimit.toLocaleString()} lines
            </span>
          </div>
          <Slider
            value={[tmuxHistoryLimit]}
            onValueChange={([value]) => {
              setTmuxHistoryLimit(value);
              debouncedSave("tmuxHistoryLimit", value);
            }}
            min={1000}
            max={100000}
            step={5000}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Server-side scrollback buffer stored in tmux (persistent)
          </p>
        </div>
      </div>
    </div>
  );
}
