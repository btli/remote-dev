"use client";

import { TagInput, SettingToggle, EnumRadioGroup } from "../shared";
import type { ClaudeCodeConfig, ClaudeCodePermissions } from "@/types/agent-config";

interface ClaudeCodePermissionsEditorProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  disabled?: boolean;
}

const DEFAULT_MODE_OPTIONS = [
  {
    value: "acceptEdits" as const,
    label: "Accept Edits",
    description: "Automatically accept file edits without confirmation",
  },
  {
    value: "askOnEdit" as const,
    label: "Ask on Edit",
    description: "Prompt for confirmation before making file changes",
  },
  {
    value: "readOnly" as const,
    label: "Read Only",
    description: "Prevent any file modifications",
  },
];

/**
 * ClaudeCodePermissionsEditor - Permission settings for Claude Code
 *
 * Manages:
 * - Tool/file patterns that are always allowed
 * - Tools/files that require confirmation
 * - Tools/files that are blocked
 * - Additional accessible directories
 * - Default permission mode
 */
export function ClaudeCodePermissionsEditor({
  config,
  onChange,
  disabled = false,
}: ClaudeCodePermissionsEditorProps) {
  const permissions = config.permissions || {};

  const updatePermissions = (updates: Partial<ClaudeCodePermissions>) => {
    onChange({
      ...config,
      permissions: { ...permissions, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Default Mode */}
      <EnumRadioGroup
        label="Default Permission Mode"
        description="Controls how Claude Code handles file operations by default"
        value={permissions.defaultMode || "askOnEdit"}
        onChange={(value) => updatePermissions({ defaultMode: value })}
        options={DEFAULT_MODE_OPTIONS}
        disabled={disabled}
      />

      {/* Allow Patterns */}
      <TagInput
        label="Always Allow"
        description="Tool or file patterns that are automatically approved (e.g., Read, *.md)"
        value={permissions.allow || []}
        onChange={(allow) => updatePermissions({ allow })}
        placeholder="Add pattern and press Enter"
        disabled={disabled}
      />

      {/* Ask Patterns */}
      <TagInput
        label="Ask for Confirmation"
        description="Patterns that require user confirmation before execution"
        value={permissions.ask || []}
        onChange={(ask) => updatePermissions({ ask })}
        placeholder="Add pattern and press Enter"
        disabled={disabled}
      />

      {/* Deny Patterns */}
      <TagInput
        label="Block (Deny)"
        description="Patterns that are never allowed (e.g., sensitive files, dangerous commands)"
        value={permissions.deny || []}
        onChange={(deny) => updatePermissions({ deny })}
        placeholder="Add pattern and press Enter"
        disabled={disabled}
      />

      {/* Additional Directories */}
      <TagInput
        label="Additional Directories"
        description="Extra directories Claude Code can access outside the workspace"
        value={permissions.additionalDirectories || []}
        onChange={(additionalDirectories) =>
          updatePermissions({ additionalDirectories })
        }
        placeholder="/path/to/directory"
        disabled={disabled}
      />

      {/* Bypass Prevention */}
      <SettingToggle
        label="Disable Permission Bypass"
        description="Prevent Claude from asking to bypass permission restrictions"
        value={permissions.disableBypassPermissionsMode ?? false}
        onChange={(value) =>
          updatePermissions({ disableBypassPermissionsMode: value })
        }
        disabled={disabled}
      />
    </div>
  );
}
