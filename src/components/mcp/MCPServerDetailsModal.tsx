"use client";

import { useState } from "react";
import {
  Server,
  Terminal,
  Globe,
  FolderOpen,
  Copy,
  Check,
  Wrench,
  FileJson,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParsedMCPServer } from "@/types/agent-mcp";
import { getServerKey } from "@/lib/mcp-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSessionMCP } from "@/contexts/SessionMCPContext";

/**
 * Transport type badge colors and labels.
 */
const TRANSPORT_CONFIG: Record<string, { label: string; className: string; icon: typeof Globe }> = {
  stdio: { label: "stdio", className: "bg-blue-500/20 text-blue-400", icon: Terminal },
  http: { label: "http", className: "bg-green-500/20 text-green-400", icon: Globe },
  sse: { label: "sse", className: "bg-purple-500/20 text-purple-400", icon: Globe },
};

interface MCPServerDetailsModalProps {
  server: ParsedMCPServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MCPServerDetailsModal({
  server,
  open,
  onOpenChange,
}: MCPServerDetailsModalProps) {
  const { toggleServerEnabled, getServerDiscovery, discoverServer, discovering } = useSessionMCP();
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("details");

  // Get discovery state from context
  const serverKey = getServerKey(server);
  const discovery = getServerDiscovery(server);
  const tools = discovery?.tools ?? [];
  const discoveryError = discovery?.error ?? null;
  const isDiscovering = discovering.has(serverKey);
  const discoveryStatus = discovery?.discoveryStatus ?? "idle";

  const transport = TRANSPORT_CONFIG[server.transport] || TRANSPORT_CONFIG.stdio;
  const TransportIcon = transport.icon;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    await toggleServerEnabled(server, enabled);
  };

  // Build full command string
  const fullCommand = server.args.length > 0
    ? `${server.command} ${server.args.join(" ")}`
    : server.command;

  // Format environment variables
  const envEntries = Object.entries(server.env);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[80vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Server className="w-5 h-5 text-primary" />
            {server.name}
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium ml-2",
                transport.className
              )}
            >
              {transport.label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-full bg-muted/50 flex-shrink-0">
            <TabsTrigger value="details" className="flex-1 gap-1.5 text-xs">
              <FileJson className="w-3.5 h-3.5" />
              Details
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex-1 gap-1.5 text-xs">
              <Wrench className="w-3.5 h-3.5" />
              Tools
              {tools.length > 0 && (
                <span className="ml-1 text-[10px] bg-muted px-1 rounded">
                  {tools.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-y-auto mt-4">
            {/* Details Tab */}
            <TabsContent value="details" className="mt-0 space-y-4">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2">
                  <Label htmlFor="enabled" className="text-sm font-medium">
                    Enabled
                  </Label>
                </div>
                <Switch
                  id="enabled"
                  checked={server.enabled}
                  onCheckedChange={handleToggleEnabled}
                />
              </div>

              {/* Transport */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Transport
                </Label>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <TransportIcon className={cn("w-4 h-4", transport.className.replace("bg-", "text-").replace("/20", ""))} />
                  <span className="text-sm">{server.transport}</span>
                </div>
              </div>

              {/* Command */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Command
                </Label>
                <div className="relative group">
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/50 font-mono text-xs break-all">
                    {fullCommand}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard(fullCommand, "command")}
                  >
                    {copied === "command" ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Arguments (if any) */}
              {server.args.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Arguments
                  </Label>
                  <div className="space-y-1">
                    {server.args.map((arg, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-muted/30 border border-border/50 font-mono text-xs"
                      >
                        {arg}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Environment Variables */}
              {envEntries.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Environment Variables
                  </Label>
                  <div className="space-y-1">
                    {envEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 p-2 rounded bg-muted/30 border border-border/50"
                      >
                        <span className="font-mono text-xs font-medium text-primary">
                          {key}
                        </span>
                        <span className="text-muted-foreground">=</span>
                        <span className="font-mono text-xs truncate flex-1">
                          {value.startsWith("$") ? (
                            <span className="text-yellow-400">{value}</span>
                          ) : (
                            value
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Source file */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Source File
                </Label>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs truncate">{server.sourceFile}</span>
                </div>
              </div>
            </TabsContent>

            {/* Tools Tab */}
            <TabsContent value="tools" className="mt-0">
              {isDiscovering ? (
                // Discovering state
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Discovering tools...
                  </p>
                </div>
              ) : discoveryError ? (
                // Error state
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-destructive">
                  <AlertCircle className="w-6 h-6" />
                  <p className="text-sm font-medium">Discovery Failed</p>
                  <p className="text-xs text-center max-w-xs text-muted-foreground">
                    {discoveryError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => discoverServer(server)}
                    className="mt-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-2" />
                    Retry
                  </Button>
                </div>
              ) : discoveryStatus === "idle" || tools.length === 0 ? (
                // Not yet discovered or no tools found
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Wrench className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {discoveryStatus === "completed"
                      ? "No tools found on this server"
                      : "Tools not yet discovered"}
                  </p>
                  {!server.enabled ? (
                    <p className="text-xs text-muted-foreground text-center">
                      Enable the server to discover tools
                    </p>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => discoverServer(server)}
                      className="mt-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-2" />
                      {discoveryStatus === "completed" ? "Refresh" : "Discover Tools"}
                    </Button>
                  )}
                </div>
              ) : (
                // Tool list
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground">
                      {tools.length} {tools.length === 1 ? "tool" : "tools"} discovered
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => discoverServer(server)}
                      className="h-7 px-2"
                    >
                      <RefreshCw className="w-3 h-3 mr-1.5" />
                      Refresh
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="p-3 rounded-lg bg-muted/30 border border-border/50"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Wrench className="w-3.5 h-3.5 text-primary" />
                          <span className="font-mono text-sm font-medium">
                            {tool.name}
                          </span>
                        </div>
                        {tool.description && (
                          <p className="text-xs text-muted-foreground ml-5">
                            {tool.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
