"use client";

/**
 * InsightsPanel - Sidebar panel wrapper for InsightsDashboardWidget.
 *
 * Provides consistent interface with MemoryPanel and NotesSidebar
 * for use in the unified RightSidebar component.
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Lightbulb, ChevronRight } from "lucide-react";
import { InsightsDashboardWidget } from "./InsightsDashboardWidget";

interface InsightsPanelProps {
  sessionId: string | null;
  folderId: string | null;
  className?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  width?: number;
}

export function InsightsPanel({
  folderId,
  className,
  collapsed = false,
  onCollapsedChange,
  width = 280,
}: InsightsPanelProps) {
  // Collapsed state handled by parent (RightSidebar)
  if (collapsed) {
    return null;
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex flex-col h-full",
          "bg-card/50 backdrop-blur-sm",
          "border-l border-border",
          className
        )}
        style={{ width }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium">Insights</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onCollapsedChange?.(true)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Collapse</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <InsightsDashboardWidget
          folderId={folderId}
          showHeader={false}
          maxHeight={undefined}
          className="flex-1 overflow-hidden"
        />
      </div>
    </TooltipProvider>
  );
}

export default InsightsPanel;
