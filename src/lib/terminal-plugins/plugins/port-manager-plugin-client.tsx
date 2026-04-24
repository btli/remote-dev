/**
 * PortManagerPlugin (client half) — React rendering for the Port Manager
 * terminal tab. Hosts the same Allocations / Frameworks tabs the legacy
 * `PortManagerModal` rendered, minus the Dialog wrapper so it fills the
 * workspace pane. Active-tab state is persisted via
 * `updateSession({ typeMetadataPatch })` so reloads and scope-key dedup
 * reopens restore the previously-viewed tab.
 *
 * @see ./port-manager-plugin-server.ts for lifecycle.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Network,
  ListFilter,
  Cpu,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePortContext } from "@/contexts/PortContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { PortAllocationsTab } from "@/components/ports/PortAllocationsTab";
import { FrameworkDetectionTab } from "@/components/ports/FrameworkDetectionTab";
import type {
  PortManagerActiveTab,
  PortManagerMetadata,
} from "./port-manager-plugin-server";

// Re-export so client code can import the metadata shape without crossing
// the server file boundary.
export type {
  PortManagerActiveTab,
  PortManagerMetadata,
} from "./port-manager-plugin-server";

const DEFAULT_TAB: PortManagerActiveTab = "allocations";

function normalizeTab(value: unknown): PortManagerActiveTab {
  if (value === "allocations" || value === "frameworks") {
    return value;
  }
  return DEFAULT_TAB;
}

/**
 * Main component for `terminalType === "port-manager"`.
 *
 * Active tab is persisted back onto the session so reopening the pane lands
 * on the previously-selected tab. Selected-folder state is purely
 * transient — it doesn't need to survive a reload.
 */
function PortManagerTabContent({ session }: TerminalTypeClientComponentProps) {
  const {
    allocations,
    activePorts,
    loading,
    monitoring,
    checkPortsNow,
    refreshAllocations,
  } = usePortContext();
  const { updateSession } = useSessionContext();

  const metadata = (session.typeMetadata ?? null) as PortManagerMetadata | null;
  const activeTab = normalizeTab(metadata?.activeTab);

  // Selected folder is a transient within-pane selection used by the two
  // inner tabs to drive their filter — not worth persisting.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Refresh ports when the pane mounts (mirrors legacy modal-open behavior).
  useEffect(() => {
    void refreshAllocations();
    void checkPortsNow();
    // Intentionally run on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = allocations.length;
    const active = allocations.filter((a) => activePorts.has(a.port)).length;
    const folders = new Set(allocations.map((a) => a.folderId)).size;
    return { total, active, folders };
  }, [allocations, activePorts]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshAllocations(), checkPortsNow()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAllocations, checkPortsNow]);

  const handleTabChange = useCallback(
    (value: string) => {
      const next = normalizeTab(value);
      // Persist through typeMetadataPatch — the PATCH /api/sessions/:id route
      // only honors that field (full metadata blobs are silently dropped).
      void updateSession(session.id, {
        typeMetadataPatch: { activeTab: next },
      });
    },
    [session.id, updateSession]
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-2 text-foreground text-base font-semibold">
          <Network className="w-5 h-5 text-primary" />
          Port Manager
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage port allocations across folders
        </p>
      </div>

      {/* Quick Stats Bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="bg-muted/50 text-muted-foreground border-border"
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
            className="bg-primary/10 text-primary border-primary/30"
          >
            {stats.folders} folder{stats.folders !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {monitoring.lastCheck && (
            <span className="text-xs text-muted-foreground/70">
              Last check: {new Date(monitoring.lastCheck).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex-1 flex flex-col min-h-0 px-6 py-4"
        >
          <TabsList className="w-full bg-muted/50 flex-shrink-0">
            <TabsTrigger
              value="allocations"
              className="data-[state=active]:bg-primary/20"
            >
              <ListFilter className="w-4 h-4 mr-2" />
              Allocations
            </TabsTrigger>
            <TabsTrigger
              value="frameworks"
              className="data-[state=active]:bg-primary/20"
            >
              <Cpu className="w-4 h-4 mr-2" />
              Frameworks
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 mt-4 overflow-hidden">
            <TabsContent value="allocations" className="h-full m-0">
              <ScrollArea className="h-full pr-4">
                <PortAllocationsTab
                  selectedFolderId={selectedFolderId}
                  onSelectFolder={setSelectedFolderId}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="frameworks" className="h-full m-0">
              <ScrollArea className="h-full pr-4">
                <FrameworkDetectionTab
                  selectedFolderId={selectedFolderId}
                  onSelectFolder={setSelectedFolderId}
                />
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}

/** Default port-manager client plugin instance */
export const PortManagerClientPlugin: TerminalTypeClientPlugin = {
  type: "port-manager",
  displayName: "Ports",
  description: "Port allocations and framework detection",
  icon: Network,
  priority: 55,
  builtIn: true,
  component: PortManagerTabContent,
  deriveTitle: () => "Ports",
};
