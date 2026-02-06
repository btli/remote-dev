"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Server,
  Plug,
  Unplug,
  RefreshCw,
  Loader2,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionMCP } from "@/contexts/SessionMCPContext";
import type { ParsedMCPServer } from "@/types/agent-mcp";
import { getServerKey } from "@/lib/mcp-utils";
import { MCPServerDetailsModal } from "./MCPServerDetailsModal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

/**
 * Transport type badge colors and labels.
 */
const TRANSPORT_CONFIG: Record<string, { label: string; className: string }> = {
  stdio: { label: "stdio", className: "bg-blue-500/20 text-blue-400" },
  http: { label: "http", className: "bg-green-500/20 text-green-400" },
  sse: { label: "sse", className: "bg-purple-500/20 text-purple-400" },
};

interface MCPServersSectionProps {
  /** Whether the section is collapsed */
  collapsed?: boolean;
}

export function MCPServersSection({ collapsed = false }: MCPServersSectionProps) {
  const {
    mcpSupported,
    servers,
    loading,
    error,
    agentProvider,
    refreshMCPServers,
    toggleServerEnabled,
    configFilesFound,
  } = useSessionMCP();

  const [expanded, setExpanded] = useState(false);
  const [selectedServer, setSelectedServer] = useState<ParsedMCPServer | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Don't render if MCP not supported or no agent provider
  if (!mcpSupported || !agentProvider) {
    return null;
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMCPServers();
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleEnabled = async (server: ParsedMCPServer, enabled: boolean) => {
    await toggleServerEnabled(server, enabled);
  };

  // Collapsed view - just show icon with count
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "w-full flex items-center justify-center p-2 rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "transition-colors"
            )}
          >
            <Server className="w-4 h-4" />
            {servers.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                {servers.length}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          MCP Servers ({servers.length})
        </TooltipContent>
      </Tooltip>
    );
  }

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <>
      <div className="border-t border-border">
        {/* Section header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2",
            "text-xs text-muted-foreground hover:text-foreground",
            "hover:bg-accent/30 transition-colors"
          )}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <Server className="w-3.5 h-3.5" />
          <span className="font-medium">MCP Servers</span>
          {servers.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {enabledCount}/{servers.length}
            </span>
          )}
          {(loading || refreshing) && (
            <Loader2 className="w-3 h-3 animate-spin ml-1" />
          )}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="px-2 pb-2 space-y-1">
            {/* Error state */}
            {error && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="truncate">{error}</span>
              </div>
            )}

            {/* Loading state */}
            {loading && servers.length === 0 && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Empty state */}
            {!loading && servers.length === 0 && !error && (
              <div className="px-2 py-3 text-center">
                <p className="text-xs text-muted-foreground">
                  No MCP servers configured
                </p>
                {configFilesFound.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Add servers to .mcp.json
                  </p>
                )}
              </div>
            )}

            {/* Server list */}
            {servers.map((server) => (
              <MCPServerItem
                key={`${server.name}-${server.sourceFile}`}
                server={server}
                onToggleEnabled={handleToggleEnabled}
                onClick={() => setSelectedServer(server)}
              />
            ))}

            {/* Refresh button */}
            {servers.length > 0 && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 px-2 py-1.5 mt-1",
                  "text-[10px] text-muted-foreground hover:text-foreground",
                  "hover:bg-accent/30 rounded transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
                Refresh
              </button>
            )}
          </div>
        )}
      </div>

      {/* Server details modal */}
      {selectedServer && (
        <MCPServerDetailsModal
          server={selectedServer}
          open={!!selectedServer}
          onOpenChange={(open) => !open && setSelectedServer(null)}
        />
      )}
    </>
  );
}

// =============================================================================
// Server Item Component
// =============================================================================

interface MCPServerItemProps {
  server: ParsedMCPServer;
  onToggleEnabled: (server: ParsedMCPServer, enabled: boolean) => void;
  onClick: () => void;
}

function MCPServerItem({ server, onToggleEnabled, onClick }: MCPServerItemProps) {
  const { getServerDiscovery, discovering } = useSessionMCP();
  const transport = TRANSPORT_CONFIG[server.transport] || TRANSPORT_CONFIG.stdio;

  // Get discovery state
  const discovery = getServerDiscovery(server);
  const toolCount = discovery?.tools?.length ?? 0;
  const hasError = discovery?.discoveryStatus === "error" || discovery?.discoveryStatus === "timeout";
  const serverKey = getServerKey(server);
  const isDiscovering = discovering.has(serverKey);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md",
        "hover:bg-accent/50 transition-colors cursor-pointer",
        !server.enabled && "opacity-60"
      )}
    >
      {/* Enabled indicator */}
      <div className="shrink-0">
        {server.enabled ? (
          <Plug className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Unplug className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Server info - clickable */}
      <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground truncate">
            {server.name}
          </span>
          <span
            className={cn(
              "text-[9px] px-1 py-0.5 rounded font-medium",
              transport.className
            )}
          >
            {transport.label}
          </span>

          {/* Tool count badge */}
          {toolCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-0.5 text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">
                  <Wrench className="w-2.5 h-2.5" />
                  {toolCount}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {toolCount} {toolCount === 1 ? "tool" : "tools"} discovered
              </TooltipContent>
            </Tooltip>
          )}

          {/* Discovery error indicator */}
          {hasError && !isDiscovering && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="w-3 h-3 text-destructive" />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Discovery failed
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </button>

      {/* Discovery spinner or toggle switch */}
      <div className="shrink-0 flex items-center gap-1">
        {isDiscovering && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={server.enabled}
            onCheckedChange={(checked) => onToggleEnabled(server, checked)}
            className="scale-75"
          />
        </div>
      </div>
    </div>
  );
}
