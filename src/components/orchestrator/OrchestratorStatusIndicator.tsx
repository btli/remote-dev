"use client";

import { Brain, Pause, Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrchestratorContext } from "@/contexts/OrchestratorContext";
import { cn } from "@/lib/utils";

/**
 * OrchestratorStatusIndicator - Shows master orchestrator status in header
 *
 * Displays:
 * - Brain icon when master orchestrator exists
 * - Green pulse when active
 * - Yellow when paused
 * - Red when has critical insights
 * - Click to toggle pause/resume
 */
export function OrchestratorStatusIndicator() {
  const {
    getMasterOrchestrator,
    pauseOrchestrator,
    resumeOrchestrator,
    insights,
    unresolvedInsightCount,
  } = useOrchestratorContext();

  const masterOrchestrator = getMasterOrchestrator();

  // Don't show if no master orchestrator
  if (!masterOrchestrator) {
    return null;
  }

  const isPaused = masterOrchestrator.status === "paused";
  const isActive = masterOrchestrator.status !== "paused";

  // Check for critical insights
  const orchestratorInsights = insights.get(masterOrchestrator.id) || [];
  const hasCriticalInsights = orchestratorInsights.some(
    (insight) => insight.severity === "critical" && !insight.resolved
  );

  const handleToggle = async () => {
    try {
      if (isPaused) {
        await resumeOrchestrator(masterOrchestrator.id);
      } else {
        await pauseOrchestrator(masterOrchestrator.id);
      }
    } catch (error) {
      console.error("Failed to toggle orchestrator:", error);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "relative",
              hasCriticalInsights && "text-red-500",
              isPaused && "text-yellow-500",
              isActive && !hasCriticalInsights && "text-green-500"
            )}
            onClick={handleToggle}
          >
            <Brain className="h-5 w-5" />

            {/* Status indicator dot */}
            {isActive && (
              <span
                className={cn(
                  "absolute top-1 right-1 h-2 w-2 rounded-full",
                  hasCriticalInsights ? "bg-red-500" : "bg-green-500",
                  "animate-pulse"
                )}
              />
            )}

            {/* Unresolved insight badge */}
            {unresolvedInsightCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {unresolvedInsightCount > 9 ? "9+" : unresolvedInsightCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            <span className="font-medium">Master Orchestrator</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {isPaused && "Paused - Click to resume"}
            {isActive && !hasCriticalInsights && "Active - Monitoring all sessions"}
            {isActive && hasCriticalInsights && "Critical issues detected"}
          </div>
          {unresolvedInsightCount > 0 && (
            <div className="text-xs text-yellow-500">
              {unresolvedInsightCount} unresolved insight{unresolvedInsightCount > 1 ? "s" : ""}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
