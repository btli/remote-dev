"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  RefreshCw,
  Loader2,
  Server,
} from "lucide-react";
import { useDevServers } from "@/contexts/DevServerContext";
import { DEV_SERVER_STATUS_STYLES } from "@/types/dev-server";
import { ProcessesTable } from "./ProcessesTable";

interface ProcessesModalProps {
  open: boolean;
  onClose: () => void;
  /** Callback to navigate to a session */
  onNavigateToSession?: (sessionId: string, showPreview?: boolean) => void;
}

export function ProcessesModal({
  open,
  onClose,
  onNavigateToSession,
}: ProcessesModalProps) {
  const {
    devServers,
    loading,
    refreshDevServers,
  } = useDevServers();

  const [refreshing, setRefreshing] = useState(false);

  // Refresh on open
  useEffect(() => {
    if (open) {
      refreshDevServers();
    }
  }, [open, refreshDevServers]);

  // Convert Map to array for stats
  const devServersList = useMemo(() => {
    return Array.from(devServers.values());
  }, [devServers]);

  // Stats
  const stats = useMemo(() => {
    const total = devServersList.length;
    const running = devServersList.filter((s) => s.status === "running").length;
    const starting = devServersList.filter((s) => s.status === "starting").length;
    const crashed = devServersList.filter((s) => s.status === "crashed").length;
    return { total, running, starting, crashed };
  }, [devServersList]);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDevServers();
    } finally {
      setRefreshing(false);
    }
  }, [refreshDevServers]);

  // Handle navigation from table
  const handleNavigateToPreview = useCallback((sessionId: string) => {
    onNavigateToSession?.(sessionId, true);
    onClose();
  }, [onNavigateToSession, onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[850px] max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10 flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Activity className="w-5 h-5 text-violet-400" />
            Processes
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            View and manage running dev server processes
          </DialogDescription>
        </DialogHeader>

        {/* Quick Stats Bar */}
        <div className="flex items-center justify-between px-1 py-2 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="bg-slate-800/50 text-slate-300 border-slate-700"
            >
              {stats.total} process{stats.total !== 1 ? "es" : ""}
            </Badge>
            {stats.running > 0 && (
              <Badge
                variant="outline"
                className={DEV_SERVER_STATUS_STYLES.running}
              >
                {stats.running} running
              </Badge>
            )}
            {stats.starting > 0 && (
              <Badge
                variant="outline"
                className={DEV_SERVER_STATUS_STYLES.starting}
              >
                {stats.starting} starting
              </Badge>
            )}
            {stats.crashed > 0 && (
              <Badge
                variant="outline"
                className={DEV_SERVER_STATUS_STYLES.crashed}
              >
                {stats.crashed} crashed
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-slate-400 hover:text-white"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>

        {loading && devServersList.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          </div>
        ) : devServersList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Server className="w-10 h-10 mb-3 opacity-50" />
            <p className="text-sm">No running processes</p>
            <p className="text-xs mt-1">
              Start a dev server from a folder&apos;s context menu
            </p>
          </div>
        ) : (
          <ProcessesTable
            devServers={devServersList}
            onNavigateToPreview={handleNavigateToPreview}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
