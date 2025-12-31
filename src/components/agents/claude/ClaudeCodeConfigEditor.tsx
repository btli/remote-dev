"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings,
  Shield,
  Box,
  Webhook,
  Server,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { ClaudeCodeCoreSettings } from "./ClaudeCodeCoreSettings";
import { ClaudeCodePermissionsEditor } from "./ClaudeCodePermissionsEditor";
import { ClaudeCodeSandboxEditor } from "./ClaudeCodeSandboxEditor";
import { ClaudeCodeHooksEditor } from "./ClaudeCodeHooksEditor";
import { ClaudeCodeMCPEditor } from "./ClaudeCodeMCPEditor";
import type { ClaudeCodeConfig } from "@/types/agent-config";
import { DEFAULT_CLAUDE_CODE_CONFIG } from "@/types/agent-config";

interface ClaudeCodeConfigEditorProps {
  config: ClaudeCodeConfig;
  onChange: (config: ClaudeCodeConfig) => void;
  onSave?: () => Promise<void>;
  onReset?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  disabled?: boolean;
}

const CONFIG_TABS = [
  {
    id: "core",
    label: "Core",
    icon: Settings,
    description: "Model, environment, output settings",
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: Shield,
    description: "Tool and file access controls",
  },
  {
    id: "sandbox",
    label: "Sandbox",
    icon: Box,
    description: "Isolation and network settings",
  },
  {
    id: "hooks",
    label: "Hooks",
    icon: Webhook,
    description: "Pre/post execution commands",
  },
  {
    id: "mcp",
    label: "MCP",
    icon: Server,
    description: "Model Context Protocol servers",
  },
] as const;

type TabId = (typeof CONFIG_TABS)[number]["id"];

/**
 * ClaudeCodeConfigEditor - Full configuration editor for Claude Code
 *
 * Combines all Claude Code settings into a tabbed interface:
 * - Core: Model, cleanup, environment, attribution, output
 * - Permissions: Allow/ask/deny patterns, directories, mode
 * - Sandbox: Isolation, network, proxy settings
 * - Hooks: Pre/post tool execution commands
 * - MCP: Model Context Protocol server management
 */
export function ClaudeCodeConfigEditor({
  config,
  onChange,
  onSave,
  onReset,
  isSaving = false,
  hasChanges = false,
  disabled = false,
}: ClaudeCodeConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>("core");

  const handleReset = () => {
    onChange(DEFAULT_CLAUDE_CODE_CONFIG);
    onReset?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with actions */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Claude Code Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure Claude Code CLI settings for this profile
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
        <TabsList className="grid grid-cols-5 w-full bg-muted/50 shrink-0">
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
          <TabsContent value="core" className="m-0">
            <ClaudeCodeCoreSettings
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="permissions" className="m-0">
            <ClaudeCodePermissionsEditor
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="sandbox" className="m-0">
            <ClaudeCodeSandboxEditor
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="hooks" className="m-0">
            <ClaudeCodeHooksEditor
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="mcp" className="m-0">
            <ClaudeCodeMCPEditor
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
