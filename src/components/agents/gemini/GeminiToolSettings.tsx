"use client";

import { SettingToggle, TagInput, EnumRadioGroup } from "../shared";
import type {
  GeminiCLIConfig,
  GeminiToolSettings as GeminiToolSettingsType,
  GeminiToolSandbox,
  GeminiToolShell,
  GeminiCoreTools,
} from "@/types/agent-config";

interface GeminiToolSettingsProps {
  config: GeminiCLIConfig;
  onChange: (config: GeminiCLIConfig) => void;
  disabled?: boolean;
}

const SANDBOX_MODE_OPTIONS = [
  {
    value: "strict" as const,
    label: "Strict",
    description: "All commands run in isolated sandbox environment",
  },
  {
    value: "permissive" as const,
    label: "Permissive",
    description: "Allow some commands to bypass sandbox for functionality",
  },
];

/**
 * GeminiToolSettings - Tool and sandbox settings for Gemini CLI
 *
 * Includes:
 * - Sandbox enable/mode
 * - Shell allowed/blocked commands
 * - Auto-accept patterns
 * - Core tools toggles (web search, maps, youtube, code execution)
 */
export function GeminiToolSettings({
  config,
  onChange,
  disabled = false,
}: GeminiToolSettingsProps) {
  const tools = config.tools || {};
  const sandbox = tools.sandbox || {};
  const shell = tools.shell || {};
  const autoAccept = tools.autoAccept || {};
  const coreTools = tools.coreTools || {};

  const updateTools = (updates: Partial<GeminiToolSettingsType>) => {
    onChange({
      ...config,
      tools: { ...tools, ...updates },
    });
  };

  const updateSandbox = (updates: Partial<GeminiToolSandbox>) => {
    updateTools({ sandbox: { ...sandbox, ...updates } });
  };

  const updateShell = (updates: Partial<GeminiToolShell>) => {
    updateTools({ shell: { ...shell, ...updates } });
  };

  const updateCoreTools = (updates: Partial<GeminiCoreTools>) => {
    updateTools({ coreTools: { ...coreTools, ...updates } });
  };

  return (
    <div className="space-y-6">
      {/* Sandbox Settings */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Sandbox</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control command execution isolation
          </p>
        </div>

        <div className="space-y-4">
          <SettingToggle
            label="Enable Sandbox"
            description="Run commands in isolated environment for security"
            value={sandbox.enabled ?? true}
            onChange={(enabled) => updateSandbox({ enabled })}
            disabled={disabled}
          />

          {sandbox.enabled && (
            <EnumRadioGroup
              label="Sandbox Mode"
              value={sandbox.mode || "permissive"}
              onChange={(mode) => updateSandbox({ mode })}
              options={SANDBOX_MODE_OPTIONS}
              disabled={disabled}
            />
          )}
        </div>
      </div>

      {/* Shell Commands */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Shell Commands
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control which shell commands can be executed
          </p>
        </div>

        <div className="space-y-4">
          <TagInput
            label="Allowed Commands"
            description="Commands that are always permitted (bypass restrictions)"
            value={shell.allowedCommands || []}
            onChange={(allowedCommands) => updateShell({ allowedCommands })}
            placeholder="Add command (e.g., ls, cat, git)"
            disabled={disabled}
          />

          <TagInput
            label="Blocked Commands"
            description="Commands that are never permitted"
            value={shell.blockedCommands || []}
            onChange={(blockedCommands) => updateShell({ blockedCommands })}
            placeholder="Add command (e.g., rm, sudo)"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Auto-Accept */}
      <TagInput
        label="Auto-Accept Patterns"
        description="Patterns for actions that are automatically approved without confirmation"
        value={autoAccept.patterns || []}
        onChange={(patterns) => updateTools({ autoAccept: { patterns } })}
        placeholder="Add pattern (e.g., read:*, edit:*.md)"
        disabled={disabled}
      />

      {/* Core Tools */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">Core Tools</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enable or disable built-in Gemini CLI tools
          </p>
        </div>

        <div className="space-y-3">
          <SettingToggle
            label="Web Search"
            description="Allow Gemini to search the web for information"
            value={coreTools.webSearch ?? true}
            onChange={(webSearch) => updateCoreTools({ webSearch })}
            disabled={disabled}
          />

          <SettingToggle
            label="Google Maps"
            description="Allow Gemini to use Google Maps for location queries"
            value={coreTools.googleMaps ?? false}
            onChange={(googleMaps) => updateCoreTools({ googleMaps })}
            disabled={disabled}
          />

          <SettingToggle
            label="YouTube"
            description="Allow Gemini to search and analyze YouTube content"
            value={coreTools.youtube ?? false}
            onChange={(youtube) => updateCoreTools({ youtube })}
            disabled={disabled}
          />

          <SettingToggle
            label="Code Execution"
            description="Allow Gemini to execute code in a sandboxed environment"
            value={coreTools.codeExecution ?? true}
            onChange={(codeExecution) => updateCoreTools({ codeExecution })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
