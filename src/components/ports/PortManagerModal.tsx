"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Network,
  ListFilter,
  Cpu,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { usePortContext } from "@/contexts/PortContext";
import { PortAllocationsTab } from "./PortAllocationsTab";
import { FrameworkDetectionTab } from "./FrameworkDetectionTab";

interface PortManagerModalProps {
  open: boolean;
  onClose: () => void;
  initialFolderId?: string | null;
}

type TabValue = "allocations" | "frameworks";

export function PortManagerModal({
  open,
  onClose,
  initialFolderId,
}: PortManagerModalProps) {
  const {
    allocations,
    activePorts,
    loading,
    monitoring,
    checkPortsNow,
    refreshAllocations,
  } = usePortContext();

  const [activeTab, setActiveTab] = useState<TabValue>("allocations");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialFolderId || null
  );
  const [refreshing, setRefreshing] = useState(false);

  // Update selected folder when initialFolderId changes
  useEffect(() => {
    if (initialFolderId) {
      setSelectedFolderId(initialFolderId);
    }
  }, [initialFolderId]);

  // Refresh ports on modal open
  useEffect(() => {
    if (open) {
      refreshAllocations();
      checkPortsNow();
    }
  }, [open, refreshAllocations, checkPortsNow]);

  // Stats
  const stats = useMemo(() => {
    const total = allocations.length;
    const active = allocations.filter((a) => activePorts.has(a.port)).length;
    const folders = new Set(allocations.map((a) => a.folderId)).size;
    return { total, active, folders };
  }, [allocations, activePorts]);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshAllocations(), checkPortsNow()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAllocations, checkPortsNow]);

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setActiveTab("allocations");
    setSelectedFolderId(initialFolderId || null);
    onClose();
  }, [initialFolderId, onClose]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] bg-slate-900/95 backdrop-blur-xl border-white/10 flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Network className="w-5 h-5 text-violet-400" />
            Port Manager
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            View and manage port allocations across folders
          </DialogDescription>
        </DialogHeader>

        {/* Quick Stats Bar */}
        <div className="flex items-center justify-between px-1 py-2 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="bg-slate-800/50 text-slate-300 border-slate-700"
            >
              {stats.total} port{stats.total !== 1 ? "s" : ""}
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            >
              {stats.active} active
            </Badge>
            <Badge
              variant="outline"
              className="bg-violet-500/10 text-violet-400 border-violet-500/30"
            >
              {stats.folders} folder{stats.folders !== 1 ? "s" : ""}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {monitoring.lastCheck && (
              <span className="text-xs text-slate-500">
                Last check: {new Date(monitoring.lastCheck).toLocaleTimeString()}
              </span>
            )}
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
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabValue)}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="w-full bg-slate-800/50 flex-shrink-0">
              <TabsTrigger
                value="allocations"
                className="data-[state=active]:bg-violet-500/20"
              >
                <ListFilter className="w-4 h-4 mr-2" />
                Allocations
              </TabsTrigger>
              <TabsTrigger
                value="frameworks"
                className="data-[state=active]:bg-violet-500/20"
              >
                <Cpu className="w-4 h-4 mr-2" />
                Frameworks
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 min-h-0 mt-4">
              {/* Allocations Tab */}
              <TabsContent value="allocations" className="h-full m-0">
                <ScrollArea className="h-[400px] pr-4">
                  <PortAllocationsTab
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={setSelectedFolderId}
                  />
                </ScrollArea>
              </TabsContent>

              {/* Frameworks Tab */}
              <TabsContent value="frameworks" className="h-full m-0">
                <ScrollArea className="h-[400px] pr-4">
                  <FrameworkDetectionTab
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={setSelectedFolderId}
                  />
                </ScrollArea>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
