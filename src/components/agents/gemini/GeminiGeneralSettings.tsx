"use client";

import { SettingToggle, SliderWithInput } from "../shared";
import type { GeminiCLIConfig, GeminiSessionRetention } from "@/types/agent-config";

interface GeminiGeneralSettingsProps {
  config: GeminiCLIConfig;
  onChange: (config: GeminiCLIConfig) => void;
  disabled?: boolean;
}

/**
 * GeminiGeneralSettings - General settings for Gemini CLI
 *
 * Includes:
 * - Preview features toggle
 * - Vim mode toggle
 * - Auto-update toggle
 * - Session retention settings (enabled, maxAge, maxCount)
 */
export function GeminiGeneralSettings({
  config,
  onChange,
  disabled = false,
}: GeminiGeneralSettingsProps) {
  const sessionRetention = config.sessionRetention || {};

  const updateConfig = (updates: Partial<GeminiCLIConfig>) => {
    onChange({ ...config, ...updates });
  };

  const updateSessionRetention = (updates: Partial<GeminiSessionRetention>) => {
    onChange({
      ...config,
      sessionRetention: { ...sessionRetention, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Feature Toggles */}
      <div className="space-y-3">
        <SettingToggle
          label="Preview Features"
          description="Enable access to preview/experimental models and features"
          value={config.previewFeatures ?? false}
          onChange={(previewFeatures) => updateConfig({ previewFeatures })}
          disabled={disabled}
        />

        <SettingToggle
          label="Vim Mode"
          description="Enable vim keybindings for text input"
          value={config.vimMode ?? false}
          onChange={(vimMode) => updateConfig({ vimMode })}
          disabled={disabled}
        />

        <SettingToggle
          label="Disable Auto-Update"
          description="Prevent automatic updates to the Gemini CLI"
          value={config.disableAutoUpdate ?? false}
          onChange={(disableAutoUpdate) => updateConfig({ disableAutoUpdate })}
          disabled={disabled}
        />
      </div>

      {/* Session Retention */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Session Retention
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control how sessions are stored and cleaned up
          </p>
        </div>

        <div className="space-y-4">
          <SettingToggle
            label="Enable Retention"
            description="Automatically clean up old sessions"
            value={sessionRetention.enabled ?? true}
            onChange={(enabled) => updateSessionRetention({ enabled })}
            disabled={disabled}
          />

          <SliderWithInput
            label="Max Age"
            description="Days to retain sessions before cleanup"
            value={sessionRetention.maxAge ?? 7}
            onChange={(maxAge) => updateSessionRetention({ maxAge })}
            min={1}
            max={90}
            step={1}
            unit="days"
            disabled={disabled || !sessionRetention.enabled}
          />

          <SliderWithInput
            label="Max Count"
            description="Maximum number of sessions to retain"
            value={sessionRetention.maxCount ?? 50}
            onChange={(maxCount) => updateSessionRetention({ maxCount })}
            min={5}
            max={500}
            step={5}
            unit="sessions"
            disabled={disabled || !sessionRetention.enabled}
          />
        </div>
      </div>
    </div>
  );
}
