"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Settings2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClaudeCodeConfigEditor,
  GeminiCLIConfigEditor,
  OpenCodeConfigEditor,
  CodexCLIConfigEditor,
} from "@/components/agents";
import type { AgentProvider } from "@/types/agent";
import type {
  ClaudeCodeConfig,
  GeminiCLIConfig,
  OpenCodeConfig,
  CodexCLIConfig,
  AgentJsonConfig,
} from "@/types/agent-config";
import {
  DEFAULT_CLAUDE_CODE_CONFIG,
  DEFAULT_GEMINI_CLI_CONFIG,
  DEFAULT_OPENCODE_CONFIG,
  DEFAULT_CODEX_CLI_CONFIG,
} from "@/types/agent-config";

interface ProfileConfigTabProps {
  profileId: string;
  provider: AgentProvider;
}

type AgentConfigType = Exclude<AgentProvider, "all">;

const ALL_AGENT_TYPES: AgentConfigType[] = ["claude", "gemini", "opencode", "codex"];

const AGENT_LABELS: Record<AgentConfigType, { label: string; icon: string }> = {
  claude: { label: "Claude Code", icon: "🤖" },
  gemini: { label: "Gemini CLI", icon: "✨" },
  opencode: { label: "OpenCode", icon: "💻" },
  codex: { label: "Codex CLI", icon: "🧠" },
};

function getDefaultConfig(agentType: AgentConfigType): AgentJsonConfig {
  switch (agentType) {
    case "claude":
      return DEFAULT_CLAUDE_CODE_CONFIG;
    case "gemini":
      return DEFAULT_GEMINI_CLI_CONFIG;
    case "opencode":
      return DEFAULT_OPENCODE_CONFIG;
    case "codex":
      return DEFAULT_CODEX_CLI_CONFIG;
  }
}

interface SingleAgentConfigProps {
  profileId: string;
  agentType: AgentConfigType;
}

/**
 * SingleAgentConfig - Config editor for a single agent type
 */
function SingleAgentConfig({ profileId, agentType }: SingleAgentConfigProps) {
  const [config, setConfig] = useState<AgentJsonConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<AgentJsonConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch config on mount
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/agent-profiles/${profileId}/configs/${agentType}`
      );

      if (response.ok) {
        const data = await response.json();
        setConfig(data.config.configJson);
        setOriginalConfig(data.config.configJson);
      } else if (response.status === 404) {
        // Config doesn't exist yet, use defaults
        const defaultConfig = getDefaultConfig(agentType);
        setConfig(defaultConfig);
        setOriginalConfig(null); // null means it hasn't been saved yet
      } else {
        const data = await response.json();
        setError(data.error || "Failed to load configuration");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, [profileId, agentType]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Check if there are unsaved changes
  const hasChanges = config !== null && JSON.stringify(config) !== JSON.stringify(originalConfig);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!config) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/agent-profiles/${profileId}/configs/${agentType}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configJson: config }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setOriginalConfig(data.config.configJson);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to save configuration");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [profileId, agentType, config]);

  // Handle reset
  const handleReset = useCallback(() => {
    if (originalConfig) {
      setConfig(originalConfig);
    } else {
      setConfig(getDefaultConfig(agentType));
    }
  }, [originalConfig, agentType]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Loading configuration...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-8 h-8 text-destructive mb-3" />
        <p className="text-sm text-destructive mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchConfig}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // No config loaded
  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Settings2 className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">No configuration found</p>
      </div>
    );
  }

  // Render the appropriate config editor
  return (
    <div className="h-full flex flex-col">
      {agentType === "claude" && (
        <ClaudeCodeConfigEditor
          config={config as ClaudeCodeConfig}
          onChange={(newConfig) => setConfig(newConfig)}
          onSave={handleSave}
          onReset={handleReset}
          isSaving={saving}
          hasChanges={hasChanges}
        />
      )}
      {agentType === "gemini" && (
        <GeminiCLIConfigEditor
          config={config as GeminiCLIConfig}
          onChange={(newConfig) => setConfig(newConfig)}
          onSave={handleSave}
          onReset={handleReset}
          isSaving={saving}
          hasChanges={hasChanges}
        />
      )}
      {agentType === "opencode" && (
        <OpenCodeConfigEditor
          config={config as OpenCodeConfig}
          onChange={(newConfig) => setConfig(newConfig)}
          onSave={handleSave}
          onReset={handleReset}
          isSaving={saving}
          hasChanges={hasChanges}
        />
      )}
      {agentType === "codex" && (
        <CodexCLIConfigEditor
          config={config as CodexCLIConfig}
          onChange={(newConfig) => setConfig(newConfig)}
          onSave={handleSave}
          onReset={handleReset}
          isSaving={saving}
          hasChanges={hasChanges}
        />
      )}
    </div>
  );
}

/**
 * ProfileConfigTab - Displays the appropriate agent config editor for a profile
 *
 * - For single-agent profiles: Shows the specific agent's config editor
 * - For "all" profiles: Shows tabs for all 4 agents (Claude, Gemini, OpenCode, Codex)
 */
export function ProfileConfigTab({ profileId, provider }: ProfileConfigTabProps) {
  const [activeAgent, setActiveAgent] = useState<AgentConfigType>("claude");

  // Single agent mode - render directly
  if (provider !== "all") {
    return <SingleAgentConfig profileId={profileId} agentType={provider} />;
  }

  // All agents mode - show tabs for each agent
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="mb-4 shrink-0">
        <h3 className="text-lg font-semibold text-foreground">
          Multi-Agent Configuration
        </h3>
        <p className="text-sm text-muted-foreground">
          Configure settings for all supported AI coding agents
        </p>
      </div>

      <Tabs
        value={activeAgent}
        onValueChange={(v) => setActiveAgent(v as AgentConfigType)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="grid grid-cols-4 w-full bg-muted/50 shrink-0">
          {ALL_AGENT_TYPES.map((type) => (
            <TabsTrigger
              key={type}
              value={type}
              className="flex items-center gap-1.5 data-[state=active]:bg-primary/20 data-[state=active]:text-primary text-xs sm:text-sm"
            >
              <span>{AGENT_LABELS[type].icon}</span>
              <span className="hidden sm:inline">{AGENT_LABELS[type].label}</span>
              <span className="sm:hidden">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* No overflow here - let child config editors handle their own scrolling */}
        <div className="mt-4 flex-1 min-h-0">
          {ALL_AGENT_TYPES.map((type) => (
            <TabsContent key={type} value={type} className="m-0 h-full min-h-0">
              <SingleAgentConfig profileId={profileId} agentType={type} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
