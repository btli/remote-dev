"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Square,
  RotateCw,
  Eye,
  ExternalLink,
  Loader2,
  Folder,
  Clock,
  Cpu,
  MemoryStick,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevServers } from "@/contexts/DevServerContext";
import type { DevServerState, DevServerStatus } from "@/types/dev-server";
import { DEV_SERVER_STATUS_STYLES } from "@/types/dev-server";

interface ProcessesTableProps {
  devServers: DevServerState[];
  onNavigateToPreview?: (sessionId: string) => void;
}

type SortField = "folder" | "port" | "status" | "cpu" | "memory";
type SortDirection = "asc" | "desc";

export function ProcessesTable({
  devServers,
  onNavigateToPreview,
}: ProcessesTableProps) {
  const { stopDevServer, restartDevServer } = useDevServers();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DevServerStatus | "all">("all");
  const [sortField, setSortField] = useState<SortField>("folder");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Filter and sort dev servers
  const filteredServers = useMemo(() => {
    let result = [...devServers];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.folderName.toLowerCase().includes(query) ||
          s.port.toString().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }

    // Apply sorting - null values always sort to end regardless of direction
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "folder":
          comparison = a.folderName.localeCompare(b.folderName);
          break;
        case "port":
          comparison = a.port - b.port;
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "cpu": {
          const cpuA = a.health?.cpuPercent;
          const cpuB = b.health?.cpuPercent;
          // Null values always sort to end
          if (cpuA == null && cpuB == null) return 0;
          if (cpuA == null) return 1; // a goes to end
          if (cpuB == null) return -1; // b goes to end
          comparison = cpuA - cpuB;
          break;
        }
        case "memory": {
          const memA = a.health?.memoryMb;
          const memB = b.health?.memoryMb;
          // Null values always sort to end
          if (memA == null && memB == null) return 0;
          if (memA == null) return 1; // a goes to end
          if (memB == null) return -1; // b goes to end
          comparison = memA - memB;
          break;
        }
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [devServers, searchQuery, statusFilter, sortField, sortDirection]);

  // Toggle sort direction or change field
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }, [sortField]);

  // Get sort icon for a column
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3 ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 ml-1" />
    );
  };

  // Handle stop action
  const handleStop = useCallback(async (folderId: string) => {
    setLoadingAction(`stop-${folderId}`);
    try {
      await stopDevServer(folderId);
    } catch (error) {
      console.error("Failed to stop server:", error);
    } finally {
      setLoadingAction(null);
    }
  }, [stopDevServer]);

  // Handle restart action
  const handleRestart = useCallback(async (folderId: string) => {
    setLoadingAction(`restart-${folderId}`);
    try {
      await restartDevServer(folderId);
    } catch (error) {
      console.error("Failed to restart server:", error);
    } finally {
      setLoadingAction(null);
    }
  }, [restartDevServer]);

  // Handle browser open
  const handleOpenBrowser = useCallback((proxyUrl: string) => {
    window.open(proxyUrl, "_blank");
  }, []);

  // Get status badge
  const getStatusBadge = (status: DevServerStatus) => {
    const baseClass = `text-xs ${DEV_SERVER_STATUS_STYLES[status]}`;
    switch (status) {
      case "running":
        return (
          <Badge variant="outline" className={baseClass}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            Running
          </Badge>
        );
      case "starting":
        return (
          <Badge variant="outline" className={baseClass}>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Starting
          </Badge>
        );
      case "crashed":
        return (
          <Badge variant="outline" className={baseClass}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 mr-1.5" />
            Crashed
          </Badge>
        );
      case "stopped":
        return (
          <Badge variant="outline" className={baseClass}>
            Stopped
          </Badge>
        );
    }
  };

  // Format time relative to now
  const formatRelativeTime = (date: Date | null) => {
    if (!date) return "—";
    const now = Date.now();
    const diff = now - new Date(date).getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter Controls */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search by folder or port..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-800/50 border-slate-700 text-sm"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as DevServerStatus | "all")}
        >
          <SelectTrigger className="w-[140px] bg-slate-800/50 border-slate-700 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="starting">Starting</SelectItem>
            <SelectItem value="crashed">Crashed</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="min-w-[700px]">
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_100px_100px_100px_140px] gap-2 px-3 py-2 text-xs font-medium text-slate-400 border-b border-white/5">
            <button
              onClick={() => handleSort("folder")}
              className="flex items-center hover:text-white transition-colors text-left"
            >
              <Folder className="w-3 h-3 mr-1.5" />
              Folder
              {getSortIcon("folder")}
            </button>
            <button
              onClick={() => handleSort("port")}
              className="flex items-center hover:text-white transition-colors"
            >
              Port
              {getSortIcon("port")}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="flex items-center hover:text-white transition-colors"
            >
              Status
              {getSortIcon("status")}
            </button>
            <button
              onClick={() => handleSort("cpu")}
              className="flex items-center hover:text-white transition-colors"
            >
              <Cpu className="w-3 h-3 mr-1" />
              CPU
              {getSortIcon("cpu")}
            </button>
            <button
              onClick={() => handleSort("memory")}
              className="flex items-center hover:text-white transition-colors"
            >
              <MemoryStick className="w-3 h-3 mr-1" />
              Memory
              {getSortIcon("memory")}
            </button>
            <div className="text-right">Actions</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-white/5">
            {filteredServers.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-500">
                No processes match your filters
              </div>
            ) : (
              filteredServers.map((server) => (
                <div
                  key={server.folderId}
                  className="grid grid-cols-[1fr_80px_100px_100px_100px_140px] gap-2 px-3 py-3 items-center hover:bg-slate-800/30 transition-colors"
                >
                  {/* Folder */}
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-white truncate">{server.folderName}</span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(server.health?.lastHealthCheck ?? null)}
                    </span>
                  </div>

                  {/* Port */}
                  <div className="text-sm text-slate-300 font-mono">
                    :{server.port}
                  </div>

                  {/* Status */}
                  <div>{getStatusBadge(server.status)}</div>

                  {/* CPU */}
                  <div className="flex flex-col gap-1">
                    {server.health?.cpuPercent != null ? (
                      <>
                        <Progress
                          value={Math.min(server.health.cpuPercent, 100)}
                          className={cn(
                            "h-1.5",
                            server.health.cpuPercent > 80 ? "[&>div]:bg-red-500" :
                            server.health.cpuPercent > 50 ? "[&>div]:bg-amber-500" :
                            "[&>div]:bg-emerald-500"
                          )}
                        />
                        <span className="text-xs text-slate-400">
                          {server.health.cpuPercent.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>

                  {/* Memory */}
                  <div className="text-xs text-slate-400">
                    {server.health?.memoryMb != null ? (
                      `${server.health.memoryMb.toFixed(0)} MB`
                    ) : (
                      "—"
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    {/* Preview */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onNavigateToPreview?.(server.sessionId)}
                      disabled={server.status !== "running"}
                      className="h-7 w-7 text-slate-400 hover:text-violet-400 hover:bg-violet-400/10"
                      title="Go to Preview"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>

                    {/* Open in Browser */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleOpenBrowser(server.proxyUrl)}
                      disabled={server.status !== "running"}
                      className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10"
                      title="Open in Browser"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>

                    {/* Restart */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRestart(server.folderId)}
                      disabled={!!loadingAction}
                      className="h-7 w-7 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10"
                      title="Restart Server"
                    >
                      {loadingAction === `restart-${server.folderId}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="w-3.5 h-3.5" />
                      )}
                    </Button>

                    {/* Stop */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleStop(server.folderId)}
                      disabled={!!loadingAction || server.status === "stopped"}
                      className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-400/10"
                      title="Stop Server"
                    >
                      {loadingAction === `stop-${server.folderId}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Summary Footer */}
      <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500 border-t border-white/5 flex-shrink-0 mt-2">
        <span>
          Showing {filteredServers.length} of {devServers.length} process{devServers.length !== 1 ? "es" : ""}
        </span>
        {searchQuery || statusFilter !== "all" ? (
          <button
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="text-violet-400 hover:text-violet-300"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
