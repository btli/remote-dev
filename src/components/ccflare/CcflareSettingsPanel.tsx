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
  ExternalLink,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCcflareContext } from "@/contexts/CcflareContext";
import { cn } from "@/lib/utils";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

interface CcflareSettingsPanelProps {
  prefill?: { baseUrl?: string; apiKey?: string };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- prefill kept for future use by endpoint indicator
export function CcflareSettingsPanel({ prefill }: CcflareSettingsPanelProps) {
  const {
    config,
    status,
    loading,
    updateConfig,
    start,
    stop,
    restart,
    isRunning,
  } = useCcflareContext();

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

      {/* Section 3: ccflare Dashboard (embedded) */}
      {isRunning && (
        <div className="space-y-2">
          <Label className="text-foreground text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Dashboard
          </Label>
          <div className="rounded-lg border border-border overflow-hidden bg-background">
            <iframe
              src="/ccflare/dashboard"
              className="w-full border-0"
              style={{ height: "600px" }}
              title="ccflare Dashboard"
            />
          </div>
        </div>
      )}
    </div>
  );
}
