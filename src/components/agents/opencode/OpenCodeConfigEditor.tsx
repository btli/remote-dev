"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Cpu,
  Monitor,
  Wrench,
  Code2,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { SettingToggle, SliderWithInput, EnumRadioGroup, TagInput } from "../shared";
import type { OpenCodeConfig } from "@/types/agent-config";
import { DEFAULT_OPENCODE_CONFIG } from "@/types/agent-config";

interface OpenCodeConfigEditorProps {
  config: OpenCodeConfig;
  onChange: (config: OpenCodeConfig) => void;
  onSave?: () => Promise<void>;
  onReset?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
  { value: "gemini-pro", label: "Gemini Pro" },
];

const THEME_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "monokai", label: "Monokai" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
];

const DIFF_STYLE_OPTIONS = [
  {
    value: "unified" as const,
    label: "Unified",
    description: "Single column diff view with +/- markers",
  },
  {
    value: "split" as const,
    label: "Split",
    description: "Side-by-side comparison view",
  },
];

const PERMISSION_MODE_OPTIONS = [
  {
    value: "ask" as const,
    label: "Ask",
    description: "Prompt for confirmation before file changes",
  },
  {
    value: "auto" as const,
    label: "Auto",
    description: "Automatically approve safe operations",
  },
  {
    value: "deny" as const,
    label: "Deny",
    description: "Block all file modifications",
  },
];

const CONFIG_TABS = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "interface", label: "Interface", icon: Monitor },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "quality", label: "Quality", icon: Code2 },
] as const;

type TabId = (typeof CONFIG_TABS)[number]["id"];

/**
 * OpenCodeConfigEditor - Full configuration editor for OpenCode
 *
 * Combines all OpenCode settings into a tabbed interface:
 * - Models: Primary and small model selection, disabled providers
 * - Interface: Theme, scroll settings, diff style
 * - Tools: Write, bash tools, permission mode
 * - Quality: Auto-lint, format settings
 */
export function OpenCodeConfigEditor({
  config,
  onChange,
  onSave,
  onReset,
  isSaving = false,
  hasChanges = false,
  disabled = false,
}: OpenCodeConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>("models");

  const models = config.models || {};
  const ui = config.interface || {};
  const tools = config.tools || {};
  const codeQuality = config.codeQuality || {};

  const handleReset = () => {
    onChange(DEFAULT_OPENCODE_CONFIG);
    onReset?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with actions */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            OpenCode Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure OpenCode settings for this profile
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={disabled || isSaving}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          {onSave && (
            <Button
              size="sm"
              onClick={onSave}
              disabled={disabled || isSaving || !hasChanges}
              className={cn(hasChanges && "animate-pulse")}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {/* Tabbed Configuration */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid grid-cols-4 w-full bg-muted/50 shrink-0">
          {CONFIG_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex items-center gap-1.5 data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-4 flex-1 overflow-y-auto pr-2">
          {/* Models Tab */}
          <TabsContent value="models" className="m-0 space-y-6">
            {/* Primary Model */}
            <div className="space-y-2">
              <Label className="text-foreground font-medium">
                Primary Model
              </Label>
              <p className="text-xs text-muted-foreground">
                The main model used for code generation and analysis
              </p>
              <Select
                value={models.model || "gpt-4o"}
                onValueChange={(model) =>
                  onChange({ ...config, models: { ...models, model } })
                }
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

            {/* Small Model */}
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Small Model</Label>
              <p className="text-xs text-muted-foreground">
                A lightweight model for quick tasks and completions
              </p>
              <Select
                value={models.smallModel || "gpt-4o-mini"}
                onValueChange={(smallModel) =>
                  onChange({ ...config, models: { ...models, smallModel } })
                }
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

            {/* Disabled Providers */}
            <TagInput
              label="Disabled Providers"
              description="Model providers to exclude from use"
              value={models.disabledProviders || []}
              onChange={(disabledProviders) =>
                onChange({ ...config, models: { ...models, disabledProviders } })
              }
              placeholder="Add provider (e.g., openai, anthropic)"
              disabled={disabled}
            />
          </TabsContent>

          {/* Interface Tab */}
          <TabsContent value="interface" className="m-0 space-y-6">
            {/* Theme */}
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Theme</Label>
              <p className="text-xs text-muted-foreground">
                Visual theme for the OpenCode interface
              </p>
              <Select
                value={ui.theme || "default"}
                onValueChange={(theme) =>
                  onChange({ ...config, interface: { ...ui, theme } })
                }
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

            {/* TUI Scroll */}
            <SettingToggle
              label="TUI Scroll"
              description="Enable scrolling in the terminal user interface"
              value={ui.tuiScroll ?? true}
              onChange={(tuiScroll) =>
                onChange({ ...config, interface: { ...ui, tuiScroll } })
              }
              disabled={disabled}
            />

            {/* Diff Style */}
            <EnumRadioGroup
              label="Diff Style"
              description="How code differences are displayed"
              value={ui.diffStyle || "unified"}
              onChange={(diffStyle) =>
                onChange({ ...config, interface: { ...ui, diffStyle } })
              }
              options={DIFF_STYLE_OPTIONS}
              disabled={disabled}
            />
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="m-0 space-y-6">
            <SettingToggle
              label="Write Tool"
              description="Allow OpenCode to create and modify files"
              value={tools.write ?? true}
              onChange={(write) =>
                onChange({ ...config, tools: { ...tools, write } })
              }
              disabled={disabled}
            />

            <SettingToggle
              label="Bash Tool"
              description="Allow OpenCode to execute shell commands"
              value={tools.bash ?? true}
              onChange={(bash) =>
                onChange({ ...config, tools: { ...tools, bash } })
              }
              disabled={disabled}
            />

            <EnumRadioGroup
              label="Permission Mode"
              description="How OpenCode handles file modification requests"
              value={tools.permissionMode || "ask"}
              onChange={(permissionMode) =>
                onChange({ ...config, tools: { ...tools, permissionMode } })
              }
              options={PERMISSION_MODE_OPTIONS}
              disabled={disabled}
            />
          </TabsContent>

          {/* Code Quality Tab */}
          <TabsContent value="quality" className="m-0 space-y-6">
            <SettingToggle
              label="Auto-Lint"
              description="Automatically lint code after modifications"
              value={codeQuality.autoLint ?? true}
              onChange={(autoLint) =>
                onChange({ ...config, codeQuality: { ...codeQuality, autoLint } })
              }
              disabled={disabled}
            />

            <SettingToggle
              label="Smart Format"
              description="Apply intelligent formatting based on file type"
              value={codeQuality.smartFormat ?? true}
              onChange={(smartFormat) =>
                onChange({
                  ...config,
                  codeQuality: { ...codeQuality, smartFormat },
                })
              }
              disabled={disabled}
            />

            <SettingToggle
              label="Format on Save"
              description="Automatically format files when saved"
              value={codeQuality.formatOnSave ?? true}
              onChange={(formatOnSave) =>
                onChange({
                  ...config,
                  codeQuality: { ...codeQuality, formatOnSave },
                })
              }
              disabled={disabled}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
