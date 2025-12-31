"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  Play,
  Settings,
  Eye,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { SettingToggle, EnumRadioGroup } from "../shared";
import type { CodexCLIConfig } from "@/types/agent-config";
import { DEFAULT_CODEX_CLI_CONFIG } from "@/types/agent-config";

interface CodexCLIConfigEditorProps {
  config: CodexCLIConfig;
  onChange: (config: CodexCLIConfig) => void;
  onSave?: () => Promise<void>;
  onReset?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: "codex-mini-latest", label: "Codex Mini (Latest)" },
  { value: "o1-mini", label: "O1 Mini" },
  { value: "o1-preview", label: "O1 Preview" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
];

const REASONING_EFFORT_OPTIONS = [
  {
    value: "low" as const,
    label: "Low",
    description: "Quick responses with minimal reasoning",
  },
  {
    value: "medium" as const,
    label: "Medium",
    description: "Balanced reasoning depth and speed",
  },
  {
    value: "high" as const,
    label: "High",
    description: "Thorough reasoning for complex tasks",
  },
];

const VERBOSITY_OPTIONS = [
  {
    value: "quiet" as const,
    label: "Quiet",
    description: "Minimal output, only essential information",
  },
  {
    value: "normal" as const,
    label: "Normal",
    description: "Standard output with reasonable detail",
  },
  {
    value: "verbose" as const,
    label: "Verbose",
    description: "Detailed output with full explanations",
  },
];

const APPROVAL_POLICY_OPTIONS = [
  {
    value: "suggest" as const,
    label: "Suggest",
    description: "Show changes and wait for approval",
  },
  {
    value: "auto-edit" as const,
    label: "Auto-Edit",
    description: "Apply edits automatically, pause for commands",
  },
  {
    value: "full-auto" as const,
    label: "Full Auto",
    description: "Execute all operations without confirmation",
  },
];

const SANDBOX_MODE_OPTIONS = [
  {
    value: "docker" as const,
    label: "Docker",
    description: "Run in isolated Docker container",
  },
  {
    value: "seatbelt" as const,
    label: "Seatbelt",
    description: "macOS sandbox restrictions",
  },
  {
    value: "none" as const,
    label: "None",
    description: "No sandboxing (use with caution)",
  },
];

const CONFIG_TABS = [
  { id: "model", label: "Model", icon: Cpu },
  { id: "execution", label: "Execution", icon: Play },
  { id: "features", label: "Features", icon: Settings },
  { id: "observability", label: "Logs", icon: Eye },
] as const;

type TabId = (typeof CONFIG_TABS)[number]["id"];

/**
 * CodexCLIConfigEditor - Full configuration editor for Codex CLI
 *
 * Combines all Codex CLI settings into a tabbed interface:
 * - Model: Model selection, reasoning effort, verbosity
 * - Execution: Approval policy, sandbox mode
 * - Features: Unified exec, skills, TUI v2
 * - Observability: Logging settings
 */
export function CodexCLIConfigEditor({
  config,
  onChange,
  onSave,
  onReset,
  isSaving = false,
  hasChanges = false,
  disabled = false,
}: CodexCLIConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>("model");

  const model = config.model || {};
  const execution = config.execution || {};
  const features = config.features || {};
  const observability = config.observability || {};

  const handleReset = () => {
    onChange(DEFAULT_CODEX_CLI_CONFIG);
    onReset?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with actions */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Codex CLI Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure Codex CLI settings for this profile
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
          {/* Model Tab */}
          <TabsContent value="model" className="m-0 space-y-6">
            {/* Model Selection */}
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Model</Label>
              <p className="text-xs text-muted-foreground">
                The OpenAI model to use for code generation
              </p>
              <Select
                value={model.model || "codex-mini-latest"}
                onValueChange={(m) =>
                  onChange({ ...config, model: { ...model, model: m } })
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

            {/* Reasoning Effort */}
            <EnumRadioGroup
              label="Reasoning Effort"
              description="How deeply the model should reason about tasks"
              value={model.reasoningEffort || "medium"}
              onChange={(reasoningEffort) =>
                onChange({ ...config, model: { ...model, reasoningEffort } })
              }
              options={REASONING_EFFORT_OPTIONS}
              disabled={disabled}
            />

            {/* Verbosity */}
            <EnumRadioGroup
              label="Verbosity"
              description="Amount of detail in model responses"
              value={model.verbosity || "normal"}
              onChange={(verbosity) =>
                onChange({ ...config, model: { ...model, verbosity } })
              }
              options={VERBOSITY_OPTIONS}
              disabled={disabled}
            />
          </TabsContent>

          {/* Execution Tab */}
          <TabsContent value="execution" className="m-0 space-y-6">
            <EnumRadioGroup
              label="Approval Policy"
              description="How Codex handles operation approvals"
              value={execution.approvalPolicy || "suggest"}
              onChange={(approvalPolicy) =>
                onChange({
                  ...config,
                  execution: { ...execution, approvalPolicy },
                })
              }
              options={APPROVAL_POLICY_OPTIONS}
              disabled={disabled}
            />

            <EnumRadioGroup
              label="Sandbox Mode"
              description="Isolation level for command execution"
              value={execution.sandboxMode || "seatbelt"}
              onChange={(sandboxMode) =>
                onChange({
                  ...config,
                  execution: { ...execution, sandboxMode },
                })
              }
              options={SANDBOX_MODE_OPTIONS}
              disabled={disabled}
            />
          </TabsContent>

          {/* Features Tab */}
          <TabsContent value="features" className="m-0 space-y-6">
            <SettingToggle
              label="Unified Execution"
              description="Use PTY-backed unified execution for commands"
              value={features.unifiedExec ?? true}
              onChange={(unifiedExec) =>
                onChange({ ...config, features: { ...features, unifiedExec } })
              }
              disabled={disabled}
            />

            <SettingToggle
              label="Skills"
              description="Enable skill discovery and execution"
              value={features.skills ?? true}
              onChange={(skills) =>
                onChange({ ...config, features: { ...features, skills } })
              }
              disabled={disabled}
            />

            <SettingToggle
              label="TUI v2"
              description="Use the new Terminal User Interface"
              value={features.tui2 ?? false}
              onChange={(tui2) =>
                onChange({ ...config, features: { ...features, tui2 } })
              }
              disabled={disabled}
            />
          </TabsContent>

          {/* Observability Tab */}
          <TabsContent value="observability" className="m-0 space-y-6">
            <SettingToggle
              label="Enable Logging"
              description="Log Codex operations for debugging"
              value={observability.loggingEnabled ?? false}
              onChange={(loggingEnabled) =>
                onChange({
                  ...config,
                  observability: { ...observability, loggingEnabled },
                })
              }
              disabled={disabled}
            />

            {/* Log Level */}
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Log Level</Label>
              <p className="text-xs text-muted-foreground">
                Minimum severity level for log messages
              </p>
              <Select
                value={observability.logLevel || "info"}
                onValueChange={(logLevel) =>
                  onChange({
                    ...config,
                    observability: {
                      ...observability,
                      logLevel: logLevel as "debug" | "info" | "warn" | "error",
                    },
                  })
                }
                disabled={disabled || !observability.loggingEnabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select log level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debug">Debug</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <SettingToggle
              label="Enable Metrics"
              description="Collect performance and usage metrics"
              value={observability.metricsEnabled ?? false}
              onChange={(metricsEnabled) =>
                onChange({
                  ...config,
                  observability: { ...observability, metricsEnabled },
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
