"use client";

/**
 * RightSidebar - Unified sidebar with Memory, Notes, and Insights tabs.
 *
 * Features a persistent icon rail that stays visible in both collapsed
 * and expanded states, allowing quick tab switching. Content panel
 * slides out to the left of the icon rail.
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Brain,
  StickyNote,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { MemoryPanel } from "@/components/memory";
import { NotesPanel } from "@/components/notes";
import { InsightsPanel } from "@/components/insights";

export type RightSidebarTab = "memory" | "notes" | "insights";

interface RightSidebarProps {
  sessionId: string | null;
  folderId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width: number;
  activeTab: RightSidebarTab;
  onActiveTabChange: (tab: RightSidebarTab) => void;
}

export function RightSidebar({
  sessionId,
  folderId,
  collapsed,
  onCollapsedChange,
  width,
  activeTab,
  onActiveTabChange,
}: RightSidebarProps) {
  // Render content panel based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case "memory":
        return (
          <MemoryPanel
            sessionId={sessionId}
            folderId={folderId}
            collapsed={false}
            onCollapsedChange={onCollapsedChange}
            width={width - 40} // Account for icon rail width
          />
        );
      case "insights":
        return (
          <InsightsPanel
            sessionId={sessionId}
            folderId={folderId}
            collapsed={false}
            onCollapsedChange={onCollapsedChange}
            width={width - 40}
          />
        );
      case "notes":
      default:
        return (
          <NotesPanel
            sessionId={sessionId}
            folderId={folderId}
            collapsed={false}
            onCollapsedChange={onCollapsedChange}
            width={width - 40}
          />
        );
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* Content panel - slides out when expanded */}
        {!collapsed && (
          <div className="flex-1 overflow-hidden">
            {renderContent()}
          </div>
        )}

        {/* Icon rail - always visible */}
        <div
          className={cn(
            "flex flex-col items-center gap-1 py-2 px-1",
            "bg-card/50 backdrop-blur-sm",
            "border-l border-border"
          )}
          style={{ width: 40 }}
        >
          {/* Memory icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === "memory" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (activeTab === "memory" && !collapsed) {
                    // Clicking active tab collapses
                    onCollapsedChange(true);
                  } else {
                    onActiveTabChange("memory");
                    onCollapsedChange(false);
                  }
                }}
              >
                <Brain className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Memory</TooltipContent>
          </Tooltip>

          {/* Notes icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === "notes" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (activeTab === "notes" && !collapsed) {
                    onCollapsedChange(true);
                  } else {
                    onActiveTabChange("notes");
                    onCollapsedChange(false);
                  }
                }}
              >
                <StickyNote className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Notes</TooltipContent>
          </Tooltip>

          {/* Insights icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === "insights" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (activeTab === "insights" && !collapsed) {
                    onCollapsedChange(true);
                  } else {
                    onActiveTabChange("insights");
                    onCollapsedChange(false);
                  }
                }}
              >
                <Lightbulb className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Insights</TooltipContent>
          </Tooltip>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Toggle expand/collapse */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onCollapsedChange(!collapsed)}
              >
                {collapsed ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {collapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
