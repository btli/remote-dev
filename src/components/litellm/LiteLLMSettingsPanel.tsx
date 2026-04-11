"use client";

/**
 * LiteLLMSettingsPanel - Settings panel for LiteLLM proxy management
 *
 * Rendered inside UserSettingsModal as the "LiteLLM" tab.
 * Provides status control, configuration, model management, and analytics.
 */

import { useState } from "react";
import {
  Network,
  Play,
  Square,
  RotateCw,
  Loader2,
  Pause,
  CirclePlay,
  Trash2,
  RefreshCw,
  Plus,
  Star,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useLiteLLMContext } from "@/contexts/LiteLLMContext";
import type { LiteLLMModel, UsageStats } from "@/types/litellm";
import { cn } from "@/lib/utils";
import { AddModelDialog } from "./AddModelDialog";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return cost > 0 ? "<$0.01" : "$0.00";
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function LiteLLMSettingsPanel() {
  const {
    config,
    status,
    models,
    usageStats,
    loading,
    updateConfig,
    start,
    stop,
    restart,
    toggleModelPause,
    setDefaultModel,
    removeModel,
    refreshModels,
    isRunning,
  } = useLiteLLMContext();

  // Config form state
  const [portValue, setPortValue] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Control action loading states
  const [controlLoading, setControlLoading] = useState(false);

  // Add model dialog
  const [addModelOpen, setAddModelOpen] = useState(false);

  const handleStartStop = async () => {
    setControlLoading(true);
    try {
      if (isRunning) {
        await stop();
      } else {
        await start();
      }
    } catch {
      // Error already toasted by context
    } finally {
      setControlLoading(false);
    }
  };

  const handleRestart = async () => {
    setControlLoading(true);
    try {
      await restart();
    } catch {
      // Error already toasted by context
    } finally {
      setControlLoading(false);
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    setSavingConfig(true);
    try {
      await updateConfig({ enabled });
    } catch {
      // Error already toasted by context
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAutoStart = async (autoStart: boolean) => {
    setSavingConfig(true);
    try {
      await updateConfig({ autoStart });
    } catch {
      // Error already toasted by context
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSavePort = async () => {
    const port = parseInt(portValue, 10);
    if (isNaN(port) || port < 1024 || port > 65535) return;

    setSavingConfig(true);
    try {
      await updateConfig({ port });
      setPortValue("");
    } catch {
      // Error already toasted by context
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status.installed) {
    return (
      <div className="text-center py-12">
        <Network className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-foreground font-medium mb-2">LiteLLM not installed</p>
        <p className="text-sm text-muted-foreground mb-4">
          Install LiteLLM to use the multi-provider AI API proxy with model routing.
        </p>
        <code className="block text-xs bg-muted/50 border border-border rounded-md px-4 py-2 text-muted-foreground mb-4">
          pip install &apos;litellm[proxy]&apos;
        </code>
        <p className="text-xs text-muted-foreground">
          Then restart the server to detect the installation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Status & Control Bar */}
      <div className="p-3 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Network className="w-5 h-5 text-muted-foreground" />
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background",
                  isRunning ? "bg-green-400" : "bg-muted-foreground/50"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {isRunning ? "Running" : "Stopped"}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {status.version && <span>v{status.version}</span>}
                {isRunning && status.port && <span>Port {status.port}</span>}
                {isRunning && status.uptime != null && (
                  <span>Uptime {formatUptime(status.uptime)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={isRunning ? "destructive" : "default"}
              onClick={handleStartStop}
              disabled={controlLoading}
              className={cn(
                "h-8",
                !isRunning && "bg-primary hover:bg-primary/90 text-primary-foreground"
              )}
            >
              {controlLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isRunning ? (
                <>
                  <Square className="w-3.5 h-3.5 mr-1.5" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Start
                </>
              )}
            </Button>
            {isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestart}
                disabled={controlLoading}
                className="h-8 border-border text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Configuration */}
      <div className="space-y-3">
        <Label className="text-foreground text-sm font-medium flex items-center gap-2">
          Configuration
        </Label>

        {/* Enable/Disable toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
          <div>
            <Label className="text-foreground">Enable proxy</Label>
            <p className="text-xs text-muted-foreground">
              Route AI agent sessions through the LiteLLM proxy for multi-provider routing.
            </p>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={handleToggleEnabled}
            disabled={savingConfig}
          />
        </div>

        {/* Auto-start toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
          <div>
            <Label className="text-foreground">Auto-start</Label>
            <p className="text-xs text-muted-foreground">
              Start proxy automatically when the server launches
            </p>
          </div>
          <Switch
            checked={config?.autoStart ?? false}
            onCheckedChange={handleToggleAutoStart}
            disabled={savingConfig}
          />
        </div>

        {/* Port number input (only when not running) */}
        {!isRunning && (
          <div className="space-y-2">
            <Label className="text-muted-foreground">Port</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={portValue || (config?.port ?? "")}
                onChange={(e) => setPortValue(e.target.value)}
                placeholder={String(config?.port ?? 4000)}
                min={1024}
                max={65535}
                className="bg-input border-border text-foreground w-32"
              />
              {portValue && portValue !== String(config?.port) && (
                <Button
                  size="sm"
                  onClick={handleSavePort}
                  disabled={savingConfig}
                  className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {savingConfig ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Port for the proxy server (1024-65535)
            </p>
          </div>
        )}
      </div>

      {/* Section 3: Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-foreground text-sm font-medium flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Models
            {models.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary/80">
                {models.length}
              </span>
            )}
          </Label>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={refreshModels}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAddModelOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Model
            </Button>
          </div>
        </div>

        {models.length === 0 ? (
          <div className="p-4 rounded-lg border border-dashed border-border text-center">
            <Settings2 className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No models configured.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 text-xs border-border text-muted-foreground hover:text-foreground"
              onClick={() => setAddModelOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Model
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                onTogglePause={() => toggleModelPause(model.id)}
                onSetDefault={() => setDefaultModel(model.id)}
                onRemove={() => removeModel(model.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section 4: Analytics */}
      {usageStats && usageStats.totalRequests > 0 && (
        <UsageAnalytics stats={usageStats} />
      )}

      <AddModelDialog open={addModelOpen} onOpenChange={setAddModelOpen} />
    </div>
  );
}

function providerColor(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic": return "text-orange-400";
    case "openai": return "text-green-400";
    case "databricks": return "text-red-400";
    case "openrouter": return "text-purple-400";
    case "azure": return "text-blue-400";
    default: return "text-muted-foreground";
  }
}

interface ModelRowProps {
  model: LiteLLMModel;
  onTogglePause: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}

function ModelRow({ model, onTogglePause, onSetDefault, onRemove }: ModelRowProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg border",
        model.paused
          ? "border-border/50 bg-card/20 opacity-60"
          : "border-border bg-card/30"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {model.modelName}
            </p>
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0", providerColor(model.provider))}
            >
              {model.provider}
            </Badge>
            {model.isDefault && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-amber-400">
                default
              </Badge>
            )}
            {model.paused && (
              <span className="text-[10px] text-amber-400">Paused</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="truncate max-w-[200px]">{model.litellmModel}</span>
            {model.apiBase && (
              <span className="truncate max-w-[150px]">{model.apiBase}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              model.isDefault
                ? "text-amber-400"
                : "text-muted-foreground hover:text-amber-400"
            )}
            onClick={onSetDefault}
            title={model.isDefault ? "Default model" : "Set as default"}
          >
            <Star
              className={cn("w-3.5 h-3.5", model.isDefault && "fill-current")}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onTogglePause}
            title={model.paused ? "Resume" : "Pause"}
          >
            {model.paused ? (
              <CirclePlay className="w-3.5 h-3.5" />
            ) : (
              <Pause className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-400"
            onClick={onRemove}
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UsageAnalytics({ stats }: { stats: UsageStats }) {
  return (
    <div className="space-y-3">
      <Label className="text-foreground text-sm font-medium flex items-center gap-2">
        Analytics
      </Label>

      {/* Summary stats 2x2 grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Total Requests
          </p>
          <p className="text-lg font-semibold text-foreground">
            {stats.totalRequests.toLocaleString()}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Total Cost
          </p>
          <p className="text-lg font-semibold text-foreground">
            {formatCost(stats.totalCost)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Total Tokens
          </p>
          <p className="text-lg font-semibold text-foreground">
            {formatTokens(stats.totalTokens)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Avg Latency
          </p>
          <p className="text-lg font-semibold text-foreground">
            {stats.avgLatencyMs.toFixed(0)}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">ms</span>
          </p>
        </div>
      </div>

      {/* Per-model breakdown table */}
      {stats.byModel && stats.byModel.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left p-2 text-muted-foreground font-medium">Model</th>
                <th className="text-right p-2 text-muted-foreground font-medium">Requests</th>
                <th className="text-right p-2 text-muted-foreground font-medium">Tokens</th>
                <th className="text-right p-2 text-muted-foreground font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.byModel?.map((row) => (
                <tr key={row.modelName} className="border-b border-border/50 last:border-0">
                  <td className="p-2 text-foreground font-medium truncate max-w-[140px]">
                    {row.modelName}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">
                    {row.requests.toLocaleString()}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">
                    {formatTokens(row.tokens)}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">
                    {formatCost(row.cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
