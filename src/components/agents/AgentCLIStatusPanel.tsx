"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Terminal,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CLIStatus {
  provider: string;
  installed: boolean;
  version?: string;
  command: string;
  path?: string;
  error?: string;
  installInstructions?: string;
  docsUrl?: string;
  requiredEnvVars?: string[];
}

interface AllCLIStatus {
  statuses: CLIStatus[];
  installedCount: number;
  totalCount: number;
  summary: string;
}

const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  claude: { icon: "🤖", color: "text-amber-400" },
  codex: { icon: "⚡", color: "text-emerald-400" },
  gemini: { icon: "✨", color: "text-blue-400" },
  opencode: { icon: "🔮", color: "text-purple-400" },
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};

export function AgentCLIStatusPanel() {
  const [status, setStatus] = useState<AllCLIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set()
  );
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const fetchStatus = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/agent-cli/status");
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch CLI status:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, provider: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCommand(provider);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">
          Checking CLI installations...
        </span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load CLI status
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            CLI Agents
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-mono",
              status.installedCount === status.totalCount
                ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                : "border-amber-500/50 text-amber-400 bg-amber-500/10"
            )}
          >
            {status.installedCount}/{status.totalCount} installed
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchStatus(true)}
          disabled={refreshing}
          className="h-7 px-2"
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", refreshing && "animate-spin")}
          />
        </Button>
      </div>

      {/* CLI Status Cards */}
      <div className="space-y-2">
        {status.statuses.map((cli) => {
          const isExpanded = expandedProviders.has(cli.provider);
          const providerStyle = PROVIDER_ICONS[cli.provider] || {
            icon: "🔧",
            color: "text-muted-foreground",
          };

          return (
            <div
              key={cli.provider}
              className={cn(
                "rounded-lg border transition-all duration-200",
                cli.installed
                  ? "border-border/50 bg-card/30"
                  : "border-destructive/30 bg-destructive/5",
                isExpanded && "ring-1 ring-primary/20"
              )}
            >
              {/* Header - Clickable */}
              <button
                onClick={() => toggleProvider(cli.provider)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors rounded-lg"
                aria-expanded={isExpanded}
                aria-label={`${PROVIDER_LABELS[cli.provider] || cli.provider} - ${cli.installed ? "Installed" : "Not installed"}. Click to ${isExpanded ? "collapse" : "expand"} details`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{providerStyle.icon}</span>
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium text-foreground">
                      {PROVIDER_LABELS[cli.provider] || cli.provider}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {cli.command}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {cli.installed ? (
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                      >
                        v{cli.version}
                      </Badge>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-xs border-destructive/30 text-destructive"
                      >
                        Not installed
                      </Badge>
                      <XCircle className="w-4 h-4 text-destructive" />
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Expandable Content */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/30">
                  {/* Path */}
                  {cli.path && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        Path
                      </span>
                      <code className="block text-xs font-mono text-foreground/80 bg-muted/30 rounded px-2 py-1.5 overflow-x-auto">
                        {cli.path}
                      </code>
                    </div>
                  )}

                  {/* Required Environment Variables */}
                  {cli.requiredEnvVars && cli.requiredEnvVars.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Key className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Required Environment Variables
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cli.requiredEnvVars.map((envVar) => (
                          <Badge
                            key={envVar}
                            variant="outline"
                            className="font-mono text-xs border-primary/30 text-primary/80"
                          >
                            {envVar}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Install Instructions */}
                  {!cli.installed && cli.installInstructions && (
                    <div className="space-y-1.5">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">
                        Installation
                      </span>
                      <div className="relative">
                        <pre className="text-xs font-mono text-foreground/80 bg-muted/30 rounded px-2 py-2 overflow-x-auto whitespace-pre-wrap">
                          {cli.installInstructions}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-1 right-1 h-6 w-6 p-0"
                          onClick={() =>
                            copyToClipboard(
                              cli.installInstructions!,
                              cli.provider
                            )
                          }
                          aria-label="Copy installation command"
                        >
                          <Copy
                            className={cn(
                              "w-3 h-3",
                              copiedCommand === cli.provider
                                ? "text-emerald-400"
                                : "text-muted-foreground"
                            )}
                          />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Documentation Link */}
                  {cli.docsUrl && (
                    <a
                      href={cli.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View Documentation
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
