"use client";

/**
 * RightSidebar - Unified sidebar with Memory, Notes, and Insights tabs.
 *
 * Features:
 * - Persistent icon rail on the LEFT of the panel content
 * - Resizable width via drag handle on the left edge
 * - Quick tab switching via icon clicks
 * - Collapse toggle to hide content but keep icons visible
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { MemoryPanel } from "@/components/memory";
import { NotesPanel } from "@/components/notes";
import { InsightsPanel } from "@/components/insights";

export type RightSidebarTab = "memory" | "notes" | "insights";

const ICON_RAIL_WIDTH = 40;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

interface RightSidebarProps {
  sessionId: string | null;
  folderId: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width: number;
  onWidthChange: (width: number) => void;
  activeTab: RightSidebarTab;
  onActiveTabChange: (tab: RightSidebarTab) => void;
}

export function RightSidebar({
  sessionId,
  folderId,
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  activeTab,
  onActiveTabChange,
}: RightSidebarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(width);

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
    },
    [width]
  );

  // Handle mouse move and up during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging left increases width, dragging right decreases
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onWidthChange]);

  // Content width excludes icon rail
  const contentWidth = width - ICON_RAIL_WIDTH;

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
            width={contentWidth}
          />
        );
      case "insights":
        return (
          <InsightsPanel
            sessionId={sessionId}
            folderId={folderId}
            collapsed={false}
            onCollapsedChange={onCollapsedChange}
            width={contentWidth}
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
            width={contentWidth}
          />
        );
    }
  };

  return (
    <TooltipProvider>
      <div
        className="flex h-full"
        style={{ width: collapsed ? ICON_RAIL_WIDTH : width }}
      >
        {/* Resize handle - on the left edge when expanded */}
        {!collapsed && (
          <div
            onMouseDown={handleMouseDown}
            className={cn(
              "w-1 h-full cursor-col-resize shrink-0",
              "hover:bg-primary/30 active:bg-primary/50 transition-colors",
              "flex items-center justify-center",
              isDragging && "bg-primary/50"
            )}
          >
            <div
              className={cn(
                "w-0.5 h-8 rounded-full bg-muted-foreground",
                "hover:bg-primary active:bg-primary/80",
                "transition-colors",
                isDragging && "bg-primary"
              )}
            />
          </div>
        )}

        {/* Icon rail - on the LEFT */}
        <div
          className={cn(
            "flex flex-col items-center gap-1 py-2 px-1 shrink-0",
            "bg-card/50 backdrop-blur-sm",
            !collapsed && "border-r border-border"
          )}
          style={{ width: ICON_RAIL_WIDTH }}
        >
          {/* Toggle expand/collapse - at TOP for consistency */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onCollapsedChange(!collapsed)}
              >
                {collapsed ? (
                  <PanelRight className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {collapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>

          {/* Memory icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === "memory" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (activeTab === "memory" && !collapsed) {
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
        </div>

        {/* Content panel - to the RIGHT of icons */}
        {!collapsed && (
          <div
            className="flex-1 overflow-hidden border-l border-border"
            style={{ width: contentWidth }}
          >
            {renderContent()}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
