"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Filter, Terminal, Activity, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditLogActionType } from "@/types/orchestrator";

interface AuditLogEntry {
  id: string;
  orchestratorId: string;
  actionType: AuditLogActionType;
  targetSessionId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

interface AuditLogSidebarProps {
  orchestratorId: string;
  orchestratorName: string;
}

/**
 * AuditLogSidebar - Shows audit trail for orchestrator actions
 *
 * Displays chronological log of:
 * - Status changes (paused, resumed)
 * - Command injections
 * - Stall detections
 * - Configuration changes
 */
export function AuditLogSidebar({
  orchestratorId,
  orchestratorName,
}: AuditLogSidebarProps) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filterType, setFilterType] = useState<AuditLogActionType | "all">("all");
  const [isLoading, setIsLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterType !== "all") {
        params.set("actionType", filterType);
      }

      const response = await fetch(
        `/api/orchestrators/${orchestratorId}/audit?${params.toString()}`
      );

      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs || []);
      }
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
    } finally {
      setIsLoading(false);
    }
  }, [orchestratorId, filterType]);

  // Fetch audit logs when opening sidebar
  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open, fetchLogs]);

  const getActionIcon = (actionType: AuditLogActionType) => {
    switch (actionType) {
      case "command_injected":
        return <Terminal className="h-4 w-4 text-blue-500" />;
      case "status_changed":
        return <Activity className="h-4 w-4 text-green-500" />;
      case "insight_generated":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "session_monitored":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getActionColor = (actionType: AuditLogActionType) => {
    switch (actionType) {
      case "command_injected":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "status_changed":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "insight_generated":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "session_monitored":
        return "bg-muted text-muted-foreground border-border";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatActionLabel = (actionType: AuditLogActionType) => {
    return actionType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4 mr-2" />
          Audit Log
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Audit Log
          </DialogTitle>
          <DialogDescription>{orchestratorName}</DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          {/* Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="command_injected">Command Injected</SelectItem>
                <SelectItem value="status_changed">Status Changed</SelectItem>
                <SelectItem value="insight_generated">Insight Generated</SelectItem>
                <SelectItem value="session_monitored">Session Monitored</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Log entries */}
          <ScrollArea className="h-[calc(100vh-240px)]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                Loading...
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <History className="h-12 w-12 mb-2" />
                <p>No audit logs found</p>
                <p className="text-sm">Actions will appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-border bg-card p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getActionIcon(log.actionType)}
                        <Badge
                          variant="outline"
                          className={cn("text-xs", getActionColor(log.actionType))}
                        >
                          {formatActionLabel(log.actionType)}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="text-xs space-y-1">
                        {Object.entries(log.details).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-muted-foreground">
                            <span className="capitalize">{key.replace(/([A-Z])/g, " $1")}:</span>
                            <span className="font-medium text-foreground">
                              {typeof value === "boolean"
                                ? value
                                  ? "Yes"
                                  : "No"
                                : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {log.targetSessionId && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Terminal className="h-3 w-3" />
                        Session: {log.targetSessionId.slice(0, 8)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
