"use client";

/**
 * CcflareSettingsPanel - Settings panel for ccflare proxy management
 *
 * Rendered inside UserSettingsModal as the "Proxy" tab.
 * Provides status control, configuration, API key management, and analytics.
 */

import { useState } from "react";
import {
  Network,
  Play,
  Square,
  RotateCw,
  Plus,
  Trash2,
  ExternalLink,
  Key,
  BarChart3,
  Loader2,
  Pause,
  CirclePlay,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCcflareContext } from "@/contexts/CcflareContext";
import { cn } from "@/lib/utils";

const PRIORITY_OPTIONS = [
  { value: "1", label: "High (1)" },
  { value: "2", label: "Normal (2)" },
  { value: "3", label: "Low (3)" },
];

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

interface CcflareSettingsPanelProps {
  prefill?: { baseUrl?: string; apiKey?: string };
}

export function CcflareSettingsPanel({ prefill }: CcflareSettingsPanelProps) {
  const {
    config,
    status,
    keys,
    stats,
    loading,
    updateConfig,
    start,
    stop,
    restart,
    addKey,
    removeKey,
    toggleKeyPause,
    isRunning,
    proxyUrl,
  } = useCcflareContext();

  // Add key form state — initialize from prefill prop if provided
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState(prefill?.apiKey ?? "");
  const [newKeyBaseUrl, setNewKeyBaseUrl] = useState(prefill?.baseUrl ?? "");
  const [newKeyPriority, setNewKeyPriority] = useState("2");
  const [addingKey, setAddingKey] = useState(false);

  // Config form state
  const [portValue, setPortValue] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Control action loading states
  const [controlLoading, setControlLoading] = useState(false);

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

  const handleAddKey = async () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) return;

    setAddingKey(true);
    try {
      await addKey({
        name: newKeyName.trim(),
        key: newKeyValue.trim(),
        baseUrl: newKeyBaseUrl.trim() || undefined,
        priority: parseInt(newKeyPriority, 10),
      });
      setNewKeyName("");
      setNewKeyValue("");
      setNewKeyBaseUrl("");
      setNewKeyPriority("2");
    } catch {
      // Error already toasted by context
    } finally {
      setAddingKey(false);
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
        <p className="text-foreground font-medium mb-2">ccflare not installed</p>
        <p className="text-sm text-muted-foreground mb-4">
          Install better-ccflare to use the Anthropic API proxy with key rotation.
        </p>
        <Button
          variant="outline"
          className="border-border text-muted-foreground hover:text-foreground"
          onClick={() =>
            window.open("https://github.com/anthropics/better-ccflare", "_blank")
          }
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Installation Guide
        </Button>
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
              Route Claude agent sessions through the proxy. Per-folder opt-out: set <code className="text-[10px] bg-muted px-1 rounded">ANTHROPIC_BASE_URL</code> in folder environment variables.
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
                placeholder={String(config?.port ?? 4080)}
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

      {/* Section 3: API Keys Management */}
      <div className="space-y-3">
        <Label className="text-foreground text-sm font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          API Keys
          {keys.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary/80">
              {keys.length}
            </span>
          )}
        </Label>

        {/* Existing keys list */}
        {keys.length > 0 ? (
          <div className="space-y-1.5">
            {keys.map((apiKey) => (
              <div
                key={apiKey.id}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-lg border transition-colors",
                  apiKey.paused
                    ? "border-border/50 bg-card/20 opacity-60"
                    : "border-border bg-card/30"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {apiKey.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0",
                          apiKey.baseUrl ? "bg-blue-500/20 text-blue-400" : "bg-primary/20 text-primary/80"
                        )}
                      >
                        {apiKey.baseUrl
                          ? (() => { try { return new URL(apiKey.baseUrl).hostname; } catch { return apiKey.baseUrl; } })()
                          : "api.anthropic.com"}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        P{apiKey.priority}
                      </Badge>
                      {apiKey.paused && (
                        <span className="text-[10px] text-amber-400">Paused</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleKeyPause(apiKey.id)}
                    title={apiKey.paused ? "Resume" : "Pause"}
                  >
                    {apiKey.paused ? (
                      <CirclePlay className="w-3.5 h-3.5" />
                    ) : (
                      <Pause className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => removeKey(apiKey.id)}
                    title="Remove key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-dashed border-border text-center">
            <Key className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              No API keys configured. Add a key to enable proxy rotation.
            </p>
          </div>
        )}

        {/* Add key form */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-3">
          <Label className="text-muted-foreground text-xs font-medium flex items-center gap-1.5">
            <Plus className="w-3 h-3" />
            Add API Key
          </Label>

          <div className="space-y-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Personal, Work)"
              className="bg-input border-border text-foreground placeholder:text-muted-foreground"
            />
            <Input
              type="password"
              value={newKeyValue}
              onChange={(e) => setNewKeyValue(e.target.value)}
              placeholder="sk-ant-..."
              className="bg-input border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
            />
            <Input
              value={newKeyBaseUrl}
              onChange={(e) => setNewKeyBaseUrl(e.target.value)}
              placeholder="ANTHROPIC_BASE_URL (leave empty for api.anthropic.com)"
              className="bg-input border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Select value={newKeyPriority} onValueChange={setNewKeyPriority}>
                <SelectTrigger className="bg-input border-border text-foreground w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="text-popover-foreground focus:bg-primary/20"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAddKey}
                disabled={addingKey || !newKeyName.trim() || !newKeyValue.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {addingKey ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Analytics Quick Stats (when running) */}
      {isRunning && stats && (
        <div className="space-y-3">
          <Label className="text-foreground text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </Label>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">Total Requests</p>
              <p className="text-lg font-semibold text-foreground mt-0.5">
                {formatNumber(stats.totalRequests)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">Success Rate</p>
              <p className={cn(
                "text-lg font-semibold mt-0.5",
                stats.successRate >= 95 ? "text-green-400" :
                stats.successRate >= 80 ? "text-amber-400" : "text-red-400"
              )}>
                {stats.successRate.toFixed(1)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">Total Tokens</p>
              <p className="text-lg font-semibold text-foreground mt-0.5">
                {formatNumber(stats.totalTokens)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-lg font-semibold text-foreground mt-0.5">
                {formatCost(stats.totalCost)}
              </p>
            </div>
          </div>

          {proxyUrl && (
            <Button
              variant="outline"
              className="w-full border-border text-muted-foreground hover:text-foreground"
              onClick={() => window.open(`${proxyUrl}/dashboard`, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Dashboard
            </Button>
          )}
        </div>
      )}

      {/* Warning when running but no keys */}
      {isRunning && keys.length === 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">
              Proxy is running but no API keys are configured. Add at least one key for the proxy to function.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
