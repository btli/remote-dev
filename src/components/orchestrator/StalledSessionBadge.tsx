"use client";

import { AlertCircle, Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOrchestratorContext } from "@/contexts/OrchestratorContext";

interface StalledSessionBadgeProps {
  sessionId: string;
  className?: string;
}

/**
 * StalledSessionBadge - Shows stall indicator for a session
 *
 * Displays a warning icon if the session has been detected as stalled
 * by any orchestrator. Shows insight details in tooltip.
 */
export function StalledSessionBadge({
  sessionId,
  className,
}: StalledSessionBadgeProps) {
  const { insights } = useOrchestratorContext();

  // Find stall insights for this session
  const stallInsights: Array<{
    message: string;
    severity: string;
    timestamp: Date;
  }> = [];

  insights.forEach((insightList) => {
    insightList
      .filter((insight) => insight.sessionId === sessionId && insight.type === "stall_detected" && !insight.resolved)
      .forEach((insight) => {
        stallInsights.push({
          message: insight.message,
          severity: insight.severity,
          timestamp: insight.createdAt,
        });
      });
  });

  // Don't show if no stall insights
  if (stallInsights.length === 0) {
    return null;
  }

  // Get the most recent/severe insight
  const mostSevere = stallInsights.reduce((prev, current) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const prevScore = severityOrder[prev.severity as keyof typeof severityOrder] ?? 999;
    const currentScore = severityOrder[current.severity as keyof typeof severityOrder] ?? 999;
    return currentScore < prevScore ? current : prev;
  });

  const isCritical = mostSevere.severity === "critical" || mostSevere.severity === "high";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
              isCritical
                ? "bg-red-500/10 text-red-500 border border-red-500/20"
                : "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20",
              className
            )}
          >
            {isCritical ? (
              <AlertCircle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            <span>Stalled</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{mostSevere.message}</p>
            <p className="text-xs text-muted-foreground">
              Detected {new Date(mostSevere.timestamp).toLocaleTimeString()}
            </p>
            {stallInsights.length > 1 && (
              <p className="text-xs text-muted-foreground">
                +{stallInsights.length - 1} more insight{stallInsights.length > 2 ? "s" : ""}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
