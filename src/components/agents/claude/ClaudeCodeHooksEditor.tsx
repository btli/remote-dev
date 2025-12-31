"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingToggle, SliderWithInput } from "../shared";
import { cn } from "@/lib/utils";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type {
  ClaudeCodeConfig,
  ClaudeCodeHooks,
  ClaudeCodeHook,
} from "@/types/agent-config";

interface ClaudeCodeHooksEditorProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  disabled?: boolean;
}

interface HookEditorProps {
  hooks: ClaudeCodeHook[];
  onChange: (hooks: ClaudeCodeHook[]) => void;
  disabled?: boolean;
}

/**
 * Single hook entry editor
 */
function HookEntry({
  hook,
  onChange,
  onRemove,
  disabled,
}: {
  hook: ClaudeCodeHook;
  onChange: (hook: ClaudeCodeHook) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-mono">
            {hook.matcher || hook.command || "New Hook"}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/50">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Matcher Pattern
            </Label>
            <Input
              value={hook.matcher || ""}
              onChange={(e) => onChange({ ...hook, matcher: e.target.value })}
              placeholder="Tool name or pattern (e.g., Bash, Edit:*.py)"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Command</Label>
            <Input
              value={hook.command || ""}
              onChange={(e) => onChange({ ...hook, command: e.target.value })}
              placeholder="Command to execute (e.g., echo 'Hook triggered')"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <SliderWithInput
            label="Timeout"
            description="Maximum execution time in milliseconds"
            value={hook.timeout ?? 5000}
            onChange={(timeout) => onChange({ ...hook, timeout })}
            min={100}
            max={60000}
            step={100}
            unit="ms"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Hook list editor for a specific hook type
 */
function HookListEditor({ hooks, onChange, disabled }: HookEditorProps) {
  const addHook = () => {
    onChange([...hooks, { matcher: "", command: "", timeout: 5000 }]);
  };

  const updateHook = (index: number, hook: ClaudeCodeHook) => {
    const updated = [...hooks];
    updated[index] = hook;
    onChange(updated);
  };

  const removeHook = (index: number) => {
    onChange(hooks.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {hooks.map((hook, index) => (
        <HookEntry
          key={index}
          hook={hook}
          onChange={(h) => updateHook(index, h)}
          onRemove={() => removeHook(index)}
          disabled={disabled}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addHook}
        disabled={disabled}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Hook
      </Button>
    </div>
  );
}

/**
 * ClaudeCodeHooksEditor - Hook configuration for Claude Code
 *
 * Manages:
 * - Pre-tool use hooks (before tool execution)
 * - Post-tool use hooks (after tool execution)
 * - Global hook disable option
 */
export function ClaudeCodeHooksEditor({
  config,
  onChange,
  disabled = false,
}: ClaudeCodeHooksEditorProps) {
  const hooks = config.hooks || {};

  const updateHooks = (updates: Partial<ClaudeCodeHooks>) => {
    onChange({
      ...config,
      hooks: { ...hooks, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Global Disable */}
      <SettingToggle
        label="Disable All Hooks"
        description="Temporarily disable all hooks without removing them"
        value={hooks.disableAllHooks ?? false}
        onChange={(disableAllHooks) => updateHooks({ disableAllHooks })}
        disabled={disabled}
      />

      {/* Pre-Tool Hooks */}
      <div
        className={cn(
          "space-y-3 rounded-lg border border-border p-4",
          hooks.disableAllHooks && "opacity-50"
        )}
      >
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Pre-Tool Use Hooks
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Commands to run before a tool is executed
          </p>
        </div>

        <HookListEditor
          hooks={hooks.PreToolUse || []}
          onChange={(PreToolUse) => updateHooks({ PreToolUse })}
          disabled={disabled || hooks.disableAllHooks}
        />
      </div>

      {/* Post-Tool Hooks */}
      <div
        className={cn(
          "space-y-3 rounded-lg border border-border p-4",
          hooks.disableAllHooks && "opacity-50"
        )}
      >
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Post-Tool Use Hooks
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Commands to run after a tool has executed
          </p>
        </div>

        <HookListEditor
          hooks={hooks.PostToolUse || []}
          onChange={(PostToolUse) => updateHooks({ PostToolUse })}
          disabled={disabled || hooks.disableAllHooks}
        />
      </div>
    </div>
  );
}
