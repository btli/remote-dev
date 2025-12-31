"use client";

import { SettingToggle, SliderWithInput, TagInput } from "../shared";
import type {
  ClaudeCodeConfig,
  ClaudeCodeSandbox,
  ClaudeCodeSandboxNetwork,
} from "@/types/agent-config";

interface ClaudeCodeSandboxEditorProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  disabled?: boolean;
}

/**
 * ClaudeCodeSandboxEditor - Sandbox and network isolation settings
 *
 * Controls:
 * - Sandbox mode enable/disable
 * - Auto-allow bash in sandbox
 * - Excluded commands from sandbox
 * - Allow unsandboxed commands
 * - Network settings (Unix sockets, local binding, proxy ports)
 */
export function ClaudeCodeSandboxEditor({
  config,
  onChange,
  disabled = false,
}: ClaudeCodeSandboxEditorProps) {
  const sandbox = config.sandbox || {};
  const network = sandbox.network || {};

  const updateSandbox = (updates: Partial<ClaudeCodeSandbox>) => {
    onChange({
      ...config,
      sandbox: { ...sandbox, ...updates },
    });
  };

  const updateNetwork = (updates: Partial<ClaudeCodeSandboxNetwork>) => {
    onChange({
      ...config,
      sandbox: {
        ...sandbox,
        network: { ...network, ...updates },
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Main Sandbox Toggle */}
      <SettingToggle
        label="Enable Sandbox"
        description="Run commands in an isolated environment for security"
        value={sandbox.enabled ?? false}
        onChange={(enabled) => updateSandbox({ enabled })}
        disabled={disabled}
      />

      {/* Sandboxed Bash */}
      <SettingToggle
        label="Auto-Allow Bash in Sandbox"
        description="Automatically approve bash commands when sandbox is enabled"
        value={sandbox.autoAllowBashIfSandboxed ?? false}
        onChange={(autoAllowBashIfSandboxed) =>
          updateSandbox({ autoAllowBashIfSandboxed })
        }
        disabled={disabled || !sandbox.enabled}
      />

      {/* Excluded Commands */}
      <TagInput
        label="Excluded Commands"
        description="Commands that should run outside the sandbox"
        value={sandbox.excludedCommands || []}
        onChange={(excludedCommands) => updateSandbox({ excludedCommands })}
        placeholder="Add command and press Enter"
        disabled={disabled}
      />

      {/* Allow Unsandboxed */}
      <SettingToggle
        label="Allow Unsandboxed Commands"
        description="Allow commands to explicitly opt out of sandbox via flag"
        value={sandbox.allowUnsandboxedCommands ?? false}
        onChange={(allowUnsandboxedCommands) =>
          updateSandbox({ allowUnsandboxedCommands })
        }
        disabled={disabled}
      />

      {/* Network Settings Section */}
      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Network Settings
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure network access for sandboxed commands
          </p>
        </div>

        <div className="space-y-4">
          {/* Unix Sockets */}
          <TagInput
            label="Allowed Unix Sockets"
            description="Unix socket paths that sandboxed commands can access"
            value={network.allowUnixSockets || []}
            onChange={(allowUnixSockets) => updateNetwork({ allowUnixSockets })}
            placeholder="/path/to/socket"
            disabled={disabled}
          />

          {/* Local Binding */}
          <SettingToggle
            label="Allow Local Binding"
            description="Allow sandboxed commands to bind to localhost ports"
            value={network.allowLocalBinding ?? false}
            onChange={(allowLocalBinding) =>
              updateNetwork({ allowLocalBinding })
            }
            disabled={disabled}
          />

          {/* HTTP Proxy Port */}
          <SliderWithInput
            label="HTTP Proxy Port"
            description="Port for HTTP proxy (0 to disable)"
            value={network.httpProxyPort ?? 0}
            onChange={(httpProxyPort) => updateNetwork({ httpProxyPort })}
            min={0}
            max={65535}
            step={1}
            disabled={disabled}
          />

          {/* SOCKS Proxy Port */}
          <SliderWithInput
            label="SOCKS5 Proxy Port"
            description="Port for SOCKS5 proxy (0 to disable)"
            value={network.socksProxyPort ?? 0}
            onChange={(socksProxyPort) => updateNetwork({ socksProxyPort })}
            min={0}
            max={65535}
            step={1}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
