"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingToggle, TagInput, SliderWithInput } from "../shared";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type {
  GeminiCLIConfig,
  GeminiSecuritySettings as GeminiSecuritySettingsType,
  GeminiHooks,
  GeminiHook,
} from "@/types/agent-config";

interface GeminiSecuritySettingsProps {
  config: GeminiCLIConfig;
  onChange: (config: GeminiCLIConfig) => void;
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
  hook: GeminiHook;
  onChange: (hook: GeminiHook) => void;
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
            {hook.command || "New Hook"}
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
            <Label className="text-xs text-muted-foreground">Command</Label>
            <Input
              value={hook.command || ""}
              onChange={(e) => onChange({ ...hook, command: e.target.value })}
              placeholder="Command to execute"
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
function HookListEditor({
  label,
  description,
  hooks,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  hooks: GeminiHook[];
  onChange: (hooks: GeminiHook[]) => void;
  disabled?: boolean;
}) {
  const addHook = () => {
    onChange([...hooks, { command: "", timeout: 5000 }]);
  };

  const updateHook = (index: number, hook: GeminiHook) => {
    const updated = [...hooks];
    updated[index] = hook;
    onChange(updated);
  };

  const removeHook = (index: number) => {
    onChange(hooks.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h4 className="text-sm font-medium text-foreground">{label}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>

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
    </div>
  );
}

/**
 * GeminiSecuritySettings - Security and hook settings for Gemini CLI
 *
 * Includes:
 * - YOLO mode prevention
 * - Environment variable redaction
 * - Hook configuration (BeforeTool, AfterTool, SessionStart, SessionEnd, Error)
 */
export function GeminiSecuritySettings({
  config,
  onChange,
  disabled = false,
}: GeminiSecuritySettingsProps) {
  const security = config.security || {};
  const hooks = config.hooks || {};
  const redaction = security.environmentVariableRedaction || {};

  const updateSecurity = (updates: Partial<GeminiSecuritySettingsType>) => {
    onChange({
      ...config,
      security: { ...security, ...updates },
    });
  };

  const updateHooks = (updates: Partial<GeminiHooks>) => {
    onChange({
      ...config,
      hooks: { ...hooks, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Security Settings */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Security</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control security-related behaviors
          </p>
        </div>

        <div className="space-y-4">
          <SettingToggle
            label="Disable YOLO Mode"
            description="Prevent automatic approval of all tool executions"
            value={security.disableYoloMode ?? true}
            onChange={(disableYoloMode) =>
              updateSecurity({ disableYoloMode })
            }
            disabled={disabled}
          />

          <SettingToggle
            label="Redact Environment Variables"
            description="Hide sensitive environment variable values in output"
            value={redaction.enabled ?? false}
            onChange={(enabled) =>
              updateSecurity({
                environmentVariableRedaction: { ...redaction, enabled },
              })
            }
            disabled={disabled}
          />

          {redaction.enabled && (
            <TagInput
              label="Redaction Patterns"
              description="Environment variable patterns to redact (e.g., *_KEY, *_SECRET)"
              value={redaction.patterns || []}
              onChange={(patterns) =>
                updateSecurity({
                  environmentVariableRedaction: { ...redaction, patterns },
                })
              }
              placeholder="Add pattern"
              disabled={disabled}
            />
          )}
        </div>
      </div>

      {/* Hooks */}
      <HookListEditor
        label="Before Tool Hooks"
        description="Commands to run before tool execution"
        hooks={hooks.BeforeTool || []}
        onChange={(BeforeTool) => updateHooks({ BeforeTool })}
        disabled={disabled}
      />

      <HookListEditor
        label="After Tool Hooks"
        description="Commands to run after tool execution"
        hooks={hooks.AfterTool || []}
        onChange={(AfterTool) => updateHooks({ AfterTool })}
        disabled={disabled}
      />

      <HookListEditor
        label="Session Start Hooks"
        description="Commands to run when a session starts"
        hooks={hooks.SessionStart || []}
        onChange={(SessionStart) => updateHooks({ SessionStart })}
        disabled={disabled}
      />

      <HookListEditor
        label="Session End Hooks"
        description="Commands to run when a session ends"
        hooks={hooks.SessionEnd || []}
        onChange={(SessionEnd) => updateHooks({ SessionEnd })}
        disabled={disabled}
      />

      <HookListEditor
        label="Error Hooks"
        description="Commands to run when an error occurs"
        hooks={hooks.Error || []}
        onChange={(Error) => updateHooks({ Error })}
        disabled={disabled}
      />
    </div>
  );
}
