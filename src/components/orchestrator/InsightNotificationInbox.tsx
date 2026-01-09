"use client";

import { useState } from "react";
import { Bell, CheckCheck, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withErrorBoundary } from "@/components/ui/error-boundary";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useOrchestratorContext } from "@/contexts/OrchestratorContext";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import type { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import type { InsightSeverity } from "@/types/orchestrator";

/**
 * InsightNotificationInbox - Notification center for orchestrator insights
 *
 * Shows all unresolved insights across all orchestrators with:
 * - Severity badges (critical, high, medium, low)
 * - Session context
 * - Suggested actions
 * - Mark as resolved action
 */
function InsightNotificationInboxComponent() {
  const {
    insights,
    unresolvedInsightCount,
    resolveInsight,
    orchestrators,
  } = useOrchestratorContext();
  const [isOpen, setIsOpen] = useState(false);

  // Collect all unresolved insights
  const allInsights: Array<OrchestratorInsight & { orchestratorName: string }> = [];
  insights.forEach((insightList, orchestratorId) => {
    const orchestrator = orchestrators.find((o) => o.id === orchestratorId);
    insightList
      .filter((i) => !i.resolved)
      .forEach((insight) => {
        allInsights.push(
          Object.assign({}, insight, {
            orchestratorName: orchestrator?.type === "master" ? "Master Control" : "Folder Control",
          })
        );
      });
  });

  // Sort by severity and date
  allInsights.sort((a, b) => {
    const severityOrder: Record<InsightSeverity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
    const severityDiff =
      (severityOrder[a.severity] ?? 999) - (severityOrder[b.severity] ?? 999);
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const handleResolve = async (insightId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await resolveInsight(insightId);
    } catch (error) {
      console.error("Failed to resolve insight:", error);
    }
  };

  const getSeverityIcon = (severity: InsightSeverity) => {
    switch (severity) {
      case "critical":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "error":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "info":
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityColor = (severity: InsightSeverity) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "error":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "warning":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      case "info":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Orchestrator insights (${unresolvedInsightCount} unresolved)`}
        >
          <Bell className="h-5 w-5" />
          {unresolvedInsightCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
              {unresolvedInsightCount > 9 ? "9+" : unresolvedInsightCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="font-semibold text-lg">Orchestrator Insights</h3>
          <Badge variant="secondary" className="ml-2">
            {unresolvedInsightCount} unresolved
          </Badge>
        </div>

        <Separator />

        <ScrollArea className="h-[400px]">
          {allInsights.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <CheckCheck className="h-12 w-12 mb-2 text-green-500" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm">No unresolved insights</p>
            </div>
          ) : (
            <div className="divide-y">
              {allInsights.map((insight) => (
                <div
                  key={insight.id}
                  className="p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {getSeverityIcon(insight.severity)}
                      <Badge
                        variant="outline"
                        className={cn("text-xs", getSeverityColor(insight.severity))}
                      >
                        {insight.severity}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => handleResolve(insight.id, e)}
                      aria-label="Resolve insight"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <p
                    className="text-sm font-medium mb-1"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(insight.message, {
                        ALLOWED_TAGS: [], // Strip all HTML tags
                        KEEP_CONTENT: true
                      })
                    }}
                  />

                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span>{insight.orchestratorName}</span>
                    <span>•</span>
                    <span>{new Date(insight.createdAt).toLocaleTimeString()}</span>
                  </div>

                  {insight.suggestedActions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Suggested actions:
                      </p>
                      {insight.suggestedActions.slice(0, 2).map((action, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-muted-foreground pl-2 border-l-2 border-muted"
                        >
                          • {action.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// Wrap with error boundary for fault isolation
export const InsightNotificationInbox = withErrorBoundary(
  InsightNotificationInboxComponent,
  {
    name: "InsightNotificationInbox",
  }
);
