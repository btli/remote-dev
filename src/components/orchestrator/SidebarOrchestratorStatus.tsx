"use client";

import { Brain, Pause, Play, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOrchestratorContext } from "@/contexts/OrchestratorContext";

interface SidebarOrchestratorStatusProps {
  folderId?: string;
  className?: string;
  onConfigure?: () => void;
}

/**
 * SidebarOrchestratorStatus - Shows orchestrator status in folder sidebar
 *
 * Displays:
 * - Master orchestrator status (if no folderId)
 * - Sub-orchestrator status for specific folder (if folderId provided)
 * - Quick pause/resume controls
 * - Configuration button
 */
export function SidebarOrchestratorStatus({
  folderId,
  className,
  onConfigure,
}: SidebarOrchestratorStatusProps) {
  const {
    getMasterOrchestrator,
    getOrchestratorForFolder,
    pauseOrchestrator,
    resumeOrchestrator,
    insights,
  } = useOrchestratorContext();

  // Get the relevant orchestrator
  const orchestrator = folderId
    ? getOrchestratorForFolder(folderId)
    : getMasterOrchestrator();

  // If no orchestrator exists, show configure button
  if (!orchestrator) {
    if (!onConfigure) return null;

    return (
      <div className={cn("flex items-center gap-2 px-3 py-2", className)}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={onConfigure}
        >
          <Brain className="h-4 w-4 mr-2" />
          <span className="text-xs">Enable Orchestrator</span>
        </Button>
      </div>
    );
  }

  const isPaused = orchestrator.status === "paused";
  const orchestratorInsights = insights.get(orchestrator.id) || [];
  const unresolvedCount = orchestratorInsights.filter((i) => !i.resolved).length;
  const hasCritical = orchestratorInsights.some(
    (i) => i.severity === "critical" && !i.resolved
  );

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (isPaused) {
        await resumeOrchestrator(orchestrator.id);
      } else {
        await pauseOrchestrator(orchestrator.id);
      }
    } catch (error) {
      console.error("Failed to toggle orchestrator:", error);
    }
  };

  return (
    <div className={cn("flex items-center justify-between gap-2 px-3 py-2", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 flex-1">
              <div className="relative">
                <Brain
                  className={cn(
                    "h-4 w-4",
                    hasCritical && "text-red-500",
                    isPaused && "text-muted-foreground",
                    !isPaused && !hasCritical && "text-green-500"
                  )}
                />
                {!isPaused && (
                  <span
                    className={cn(
                      "absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full",
                      hasCritical ? "bg-red-500" : "bg-green-500",
                      "animate-pulse"
                    )}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">
                  {folderId ? "Sub-Orchestrator" : "Master Orchestrator"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {isPaused ? "Paused" : "Monitoring"}
                  {unresolvedCount > 0 && ` • ${unresolvedCount} insight${unresolvedCount > 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="space-y-1">
              <p className="font-medium">
                {folderId ? "Folder Orchestrator" : "Master Orchestrator"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isPaused && "Paused - monitoring disabled"}
                {!isPaused && !hasCritical && "Active - monitoring sessions"}
                {!isPaused && hasCritical && "Critical issues detected"}
              </p>
              <div className="text-xs space-y-0.5 pt-1 border-t border-border">
                <div>Interval: {orchestrator.monitoringInterval}s</div>
                <div>Threshold: {orchestrator.stallThreshold}s</div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="flex items-center gap-1">
        {/* Pause/Resume button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleToggle}
              >
                {isPaused ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isPaused ? "Resume monitoring" : "Pause monitoring"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Configure button */}
        {onConfigure && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfigure();
                  }}
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Configure orchestrator</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
