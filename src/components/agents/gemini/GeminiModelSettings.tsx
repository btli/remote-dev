"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderWithInput, SettingToggle } from "../shared";
import type {
  GeminiCLIConfig,
  GeminiModelSettings as GeminiModelSettingsType,
  GeminiUISettings,
} from "@/types/agent-config";

interface GeminiModelSettingsProps {
  config: GeminiCLIConfig;
  onChange: (config: GeminiCLIConfig) => void;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { value: "gemini-exp", label: "Gemini Experimental" },
];

const THEME_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "aura", label: "Aura" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
  { value: "tokyo-night", label: "Tokyo Night" },
];

/**
 * GeminiModelSettings - Model and UI settings for Gemini CLI
 *
 * Includes:
 * - Model selection
 * - Max session turns
 * - Compression threshold
 * - Theme selection
 * - UI toggles (footer, compact mode)
 * - Accessibility options
 */
export function GeminiModelSettings({
  config,
  onChange,
  disabled = false,
}: GeminiModelSettingsProps) {
  const model = config.model || {};
  const ui = config.ui || {};

  const updateModel = (updates: Partial<GeminiModelSettingsType>) => {
    onChange({
      ...config,
      model: { ...model, ...updates },
    });
  };

  const updateUI = (updates: Partial<GeminiUISettings>) => {
    onChange({
      ...config,
      ui: { ...ui, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label className="text-foreground font-medium">Default Model</Label>
        <p className="text-xs text-muted-foreground">
          The Gemini model to use for new sessions
        </p>
        <Select
          value={model.name || "gemini-2.0-flash"}
          onValueChange={(name) => updateModel({ name })}
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

      {/* Session Turns */}
      <SliderWithInput
        label="Max Session Turns"
        description="Maximum conversation turns per session (-1 for unlimited)"
        value={model.maxSessionTurns ?? 100}
        onChange={(maxSessionTurns) => updateModel({ maxSessionTurns })}
        min={-1}
        max={1000}
        step={10}
        unit="turns"
        disabled={disabled}
      />

      {/* Compression Threshold */}
      <SliderWithInput
        label="Compression Threshold"
        description="Context usage percentage at which compression is triggered (0-1)"
        value={model.compressionThreshold ?? 0.8}
        onChange={(compressionThreshold) => updateModel({ compressionThreshold })}
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
      />

      {/* UI Settings */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            User Interface
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize the Gemini CLI appearance
          </p>
        </div>

        <div className="space-y-4">
          {/* Theme Selection */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Theme</Label>
            <Select
              value={ui.theme || "default"}
              onValueChange={(theme) => updateUI({ theme })}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SettingToggle
            label="Show Footer"
            description="Display status information in the footer"
            value={ui.showFooter ?? true}
            onChange={(showFooter) => updateUI({ showFooter })}
            disabled={disabled}
          />

          <SettingToggle
            label="Compact Mode"
            description="Use compact spacing for denser output"
            value={ui.compactMode ?? false}
            onChange={(compactMode) => updateUI({ compactMode })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Accessibility */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Accessibility</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Options to improve accessibility
          </p>
        </div>

        <div className="space-y-3">
          <SettingToggle
            label="High Contrast"
            description="Use higher contrast colors for better visibility"
            value={ui.accessibility?.highContrast ?? false}
            onChange={(highContrast) =>
              updateUI({
                accessibility: { ...ui.accessibility, highContrast },
              })
            }
            disabled={disabled}
          />

          <SettingToggle
            label="Reduced Motion"
            description="Minimize animations and transitions"
            value={ui.accessibility?.reducedMotion ?? false}
            onChange={(reducedMotion) =>
              updateUI({
                accessibility: { ...ui.accessibility, reducedMotion },
              })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
