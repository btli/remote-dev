"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderWithInput, SettingToggle, KeyValueEditor } from "../shared";
import type { ClaudeCodeConfig, ClaudeCodeAttribution } from "@/types/agent-config";

interface ClaudeCodeCoreSettingsProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-haiku-3-5", label: "Claude Haiku 3.5" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
];

/**
 * ClaudeCodeCoreSettings - Core configuration settings for Claude Code
 *
 * Includes:
 * - Model selection
 * - Session cleanup period
 * - Environment variables
 * - Attribution settings
 * - Output preferences
 */
export function ClaudeCodeCoreSettings({
  config,
  onChange,
  disabled = false,
}: ClaudeCodeCoreSettingsProps) {
  const updateConfig = (updates: Partial<ClaudeCodeConfig>) => {
    onChange({ ...config, ...updates });
  };

  const updateAttribution = (updates: Partial<ClaudeCodeAttribution>) => {
    onChange({
      ...config,
      attribution: { ...config.attribution, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label className="text-foreground font-medium">Default Model</Label>
        <p className="text-xs text-muted-foreground">
          The Claude model to use for new sessions
        </p>
        <Select
          value={config.model || "claude-sonnet-4"}
          onValueChange={(value) => updateConfig({ model: value })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {MODEL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cleanup Period */}
      <SliderWithInput
        label="Session Cleanup Period"
        description="Days after which inactive sessions are cleaned up"
        value={config.cleanupPeriodDays ?? 30}
        onChange={(value) => updateConfig({ cleanupPeriodDays: value })}
        min={1}
        max={90}
        step={1}
        unit="days"
        disabled={disabled}
      />

      {/* Environment Variables */}
      <KeyValueEditor
        label="Environment Variables"
        description="Custom environment variables injected into sessions"
        value={config.env || {}}
        onChange={(env) => updateConfig({ env })}
        keyPlaceholder="Variable name"
        valuePlaceholder="Value"
        disabled={disabled}
      />

      {/* Attribution Settings */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Attribution</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure how Claude Code attributes its contributions
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Commit Attribution
            </Label>
            <Input
              value={config.attribution?.commit || ""}
              onChange={(e) => updateAttribution({ commit: e.target.value })}
              placeholder="🤖 Generated with Claude Code"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Pull Request Attribution
            </Label>
            <Input
              value={config.attribution?.pr || ""}
              onChange={(e) => updateAttribution({ pr: e.target.value })}
              placeholder="🤖 Generated with Claude Code"
              disabled={disabled}
              className="font-mono text-sm"
            />
          </div>

          <SettingToggle
            label="Include Co-Author Line"
            description="Add Co-Authored-By to commits"
            value={config.attribution?.includeCoAuthoredBy ?? true}
            onChange={(value) =>
              updateAttribution({ includeCoAuthoredBy: value })
            }
            disabled={disabled}
          />
        </div>
      </div>

      {/* Output Settings */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Output Preferences
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control how Claude Code displays information
          </p>
        </div>

        <div className="space-y-3">
          <SettingToggle
            label="Verbose Output"
            description="Show detailed execution information"
            value={config.output?.verbose ?? false}
            onChange={(value) =>
              updateConfig({
                output: { ...config.output, verbose: value },
              })
            }
            disabled={disabled}
          />

          <SettingToggle
            label="Desktop Notifications"
            description="Show system notifications for important events"
            value={config.output?.notifications ?? true}
            onChange={(value) =>
              updateConfig({
                output: { ...config.output, notifications: value },
              })
            }
            disabled={disabled}
          />

          <SettingToggle
            label="Colored Output"
            description="Use ANSI colors in terminal output"
            value={config.output?.colors ?? true}
            onChange={(value) =>
              updateConfig({
                output: { ...config.output, colors: value },
              })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
