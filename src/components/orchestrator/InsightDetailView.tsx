"use client";

import { AlertCircle, AlertTriangle, Info, CheckCircle, Clock, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import type { InsightSeverity } from "@/types/orchestrator";

interface InsightDetailViewProps {
  insight: OrchestratorInsight;
  sessionName?: string;
  onResolve?: () => void;
  onExecuteAction?: (command: string) => void;
}

/**
 * InsightDetailView - Detailed view of an orchestrator insight
 *
 * Shows:
 * - Full insight message and context
 * - Severity and timestamp
 * - Suggested actions with execute buttons
 * - Related session information
 */
export function InsightDetailView({
  insight,
  sessionName,
  onResolve,
  onExecuteAction,
}: InsightDetailViewProps) {
  const getSeverityIcon = (severity: InsightSeverity) => {
    switch (severity) {
      case "critical":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case "error":
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case "info":
        return <Info className="h-5 w-5 text-blue-500" />;
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

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            {getSeverityIcon(insight.severity)}
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("text-xs", getSeverityColor(insight.severity))}
                >
                  {insight.severity}
                </Badge>
                {insight.resolved && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Resolved
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg">{insight.message}</CardTitle>
              {sessionName && (
                <CardDescription className="flex items-center gap-2">
                  <Terminal className="h-3 w-3" />
                  Session: {sessionName}
                </CardDescription>
              )}
            </div>
          </div>
          {!insight.resolved && onResolve && (
            <Button variant="outline" size="sm" onClick={onResolve}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Resolved
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Timestamp and duration */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span>
              Detected {new Date(insight.createdAt).toLocaleString()}
            </span>
          </div>
          {insight.context && typeof insight.context.unchangedDuration === "number" && (
            <div className="flex items-center gap-1.5">
              <span>•</span>
              <span>
                Inactive for {formatDuration(insight.context.unchangedDuration)}
              </span>
            </div>
          )}
        </div>

        <Separator />

        {/* Context details */}
        {insight.context && Object.keys(insight.context).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Context</h4>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
              {Object.entries(insight.context).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, " $1").trim()}:
                  </span>
                  <span className="font-medium">
                    {typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : typeof value === "number"
                        ? value.toString()
                        : value !== null && value !== undefined
                          ? String(value)
                          : "N/A"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested actions */}
        {insight.suggestedActions.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Suggested Actions</h4>
            <div className="space-y-2">
              {insight.suggestedActions.map((action, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-lg border p-3 space-y-2",
                    action.dangerous
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-border bg-muted/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{action.label}</p>
                      {action.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {action.description}
                        </p>
                      )}
                    </div>
                    {action.command && onExecuteAction && (
                      <Button
                        variant={action.dangerous ? "destructive" : "outline"}
                        size="sm"
                        onClick={() => onExecuteAction(action.command!)}
                        disabled={insight.resolved}
                      >
                        <Terminal className="h-3 w-3 mr-1.5" />
                        Execute
                      </Button>
                    )}
                  </div>
                  {action.command && (
                    <code className="block text-xs font-mono bg-background/50 rounded px-2 py-1 border border-border">
                      {action.command}
                    </code>
                  )}
                  {action.dangerous && (
                    <p className="text-xs text-red-500 font-medium">
                      ⚠️ This action may disrupt the session
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resolution timestamp */}
        {insight.resolved && insight.resolvedAt && (
          <>
            <Separator />
            <div className="text-xs text-muted-foreground">
              Resolved on {new Date(insight.resolvedAt).toLocaleString()}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
