"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Settings,
  Cpu,
  Wrench,
  Shield,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { GeminiGeneralSettings } from "./GeminiGeneralSettings";
import { GeminiModelSettings } from "./GeminiModelSettings";
import { GeminiToolSettings } from "./GeminiToolSettings";
import { GeminiSecuritySettings } from "./GeminiSecuritySettings";
import type { GeminiCLIConfig } from "@/types/agent-config";
import { DEFAULT_GEMINI_CLI_CONFIG } from "@/types/agent-config";

interface GeminiCLIConfigEditorProps {
  config: GeminiCLIConfig;
  onChange: (config: GeminiCLIConfig) => void;
  onSave?: () => Promise<void>;
  onReset?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  disabled?: boolean;
}

const CONFIG_TABS = [
  {
    id: "general",
    label: "General",
    icon: Settings,
    description: "Preview features, vim mode, session retention",
  },
  {
    id: "model",
    label: "Model",
    icon: Cpu,
    description: "Model selection, UI settings, accessibility",
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    description: "Sandbox, shell commands, core tools",
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    description: "YOLO mode, redaction, hooks",
  },
] as const;

type TabId = (typeof CONFIG_TABS)[number]["id"];

/**
 * GeminiCLIConfigEditor - Full configuration editor for Gemini CLI
 *
 * Combines all Gemini CLI settings into a tabbed interface:
 * - General: Preview features, vim mode, session retention
 * - Model: Model selection, session turns, UI settings, accessibility
 * - Tools: Sandbox, shell commands, auto-accept patterns, core tools
 * - Security: YOLO mode, environment redaction, hooks
 */
export function GeminiCLIConfigEditor({
  config,
  onChange,
  onSave,
  onReset,
  isSaving = false,
  hasChanges = false,
  disabled = false,
}: GeminiCLIConfigEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const handleReset = () => {
    onChange(DEFAULT_GEMINI_CLI_CONFIG);
    onReset?.();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with actions */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Gemini CLI Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure Gemini CLI settings for this profile
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
          <TabsContent value="general" className="m-0">
            <GeminiGeneralSettings
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="model" className="m-0">
            <GeminiModelSettings
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="tools" className="m-0">
            <GeminiToolSettings
              config={config}
              onChange={onChange}
              disabled={disabled || isSaving}
            />
          </TabsContent>

          <TabsContent value="security" className="m-0">
            <GeminiSecuritySettings
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
