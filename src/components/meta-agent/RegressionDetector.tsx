"use client";

/**
 * RegressionDetector - Alerts and detection for performance regressions
 *
 * Features per arXiv 2512.10398v5:
 * - Regression detection alerts
 * - Threshold-based monitoring
 * - Historical trend analysis
 * - Automated warnings
 */

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  TrendingDown,
  CheckCircle2,
  Clock,
  Settings2,
  ChevronDown,
  ChevronRight,
  Bell,
  BellOff,
  Shield,
  Target,
  Zap,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RegressionSeverity = "critical" | "warning" | "info";

export interface RegressionAlert {
  id: string;
  severity: RegressionSeverity;
  type: "score" | "duration" | "pass_rate" | "tokens";
  message: string;
  details: {
    metric: string;
    previousValue: number;
    currentValue: number;
    threshold: number;
    changePercent: number;
  };
  configVersion: number;
  detectedAt: Date;
  acknowledged: boolean;
}

export interface RegressionThresholds {
  scoreDropPercent: number;
  durationIncreasePercent: number;
  passRateDropPercent: number;
  tokenIncreasePercent: number;
}

export interface BenchmarkDataPoint {
  configVersion: number;
  score: number;
  durationMs: number;
  passRate: number;
  tokensUsed: number;
  executedAt: Date;
}

interface RegressionDetectorProps {
  /** Historical benchmark data */
  history: BenchmarkDataPoint[];
  /** Current alerts */
  alerts?: RegressionAlert[];
  /** Current thresholds */
  thresholds?: RegressionThresholds;
  /** Callback when thresholds change */
  onThresholdsChange?: (thresholds: RegressionThresholds) => void;
  /** Callback when alert is acknowledged */
  onAcknowledgeAlert?: (alertId: string) => void;
  /** Whether monitoring is enabled */
  monitoringEnabled?: boolean;
  /** Callback to toggle monitoring */
  onToggleMonitoring?: (enabled: boolean) => void;
  /** Additional CSS class */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Thresholds
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: RegressionThresholds = {
  scoreDropPercent: 5,
  durationIncreasePercent: 20,
  passRateDropPercent: 10,
  tokenIncreasePercent: 25,
};

// ─────────────────────────────────────────────────────────────────────────────
// Regression Detection Logic
// ─────────────────────────────────────────────────────────────────────────────

function detectRegressions(
  history: BenchmarkDataPoint[],
  thresholds: RegressionThresholds
): RegressionAlert[] {
  if (history.length < 2) return [];

  const alerts: RegressionAlert[] = [];
  const sorted = [...history].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime()
  );

  // Compare last two data points
  const previous = sorted[sorted.length - 2];
  const current = sorted[sorted.length - 1];

  // Score regression
  if (previous.score > 0) {
    const scoreChange = ((previous.score - current.score) / previous.score) * 100;
    if (scoreChange > thresholds.scoreDropPercent) {
      alerts.push({
        id: `score-${Date.now()}`,
        severity: scoreChange > thresholds.scoreDropPercent * 2 ? "critical" : "warning",
        type: "score",
        message: `Score dropped by ${scoreChange.toFixed(1)}%`,
        details: {
          metric: "score",
          previousValue: previous.score,
          currentValue: current.score,
          threshold: thresholds.scoreDropPercent,
          changePercent: scoreChange,
        },
        configVersion: current.configVersion,
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  // Duration regression
  if (previous.durationMs > 0) {
    const durationChange =
      ((current.durationMs - previous.durationMs) / previous.durationMs) * 100;
    if (durationChange > thresholds.durationIncreasePercent) {
      alerts.push({
        id: `duration-${Date.now()}`,
        severity:
          durationChange > thresholds.durationIncreasePercent * 2
            ? "critical"
            : "warning",
        type: "duration",
        message: `Duration increased by ${durationChange.toFixed(1)}%`,
        details: {
          metric: "duration",
          previousValue: previous.durationMs,
          currentValue: current.durationMs,
          threshold: thresholds.durationIncreasePercent,
          changePercent: durationChange,
        },
        configVersion: current.configVersion,
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  // Pass rate regression
  if (previous.passRate > 0) {
    const passRateChange =
      ((previous.passRate - current.passRate) / previous.passRate) * 100;
    if (passRateChange > thresholds.passRateDropPercent) {
      alerts.push({
        id: `pass-rate-${Date.now()}`,
        severity:
          passRateChange > thresholds.passRateDropPercent * 2
            ? "critical"
            : "warning",
        type: "pass_rate",
        message: `Pass rate dropped by ${passRateChange.toFixed(1)}%`,
        details: {
          metric: "passRate",
          previousValue: previous.passRate,
          currentValue: current.passRate,
          threshold: thresholds.passRateDropPercent,
          changePercent: passRateChange,
        },
        configVersion: current.configVersion,
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  // Token usage regression
  if (previous.tokensUsed > 0) {
    const tokenChange =
      ((current.tokensUsed - previous.tokensUsed) / previous.tokensUsed) * 100;
    if (tokenChange > thresholds.tokenIncreasePercent) {
      alerts.push({
        id: `tokens-${Date.now()}`,
        severity: "info",
        type: "tokens",
        message: `Token usage increased by ${tokenChange.toFixed(1)}%`,
        details: {
          metric: "tokensUsed",
          previousValue: previous.tokensUsed,
          currentValue: current.tokensUsed,
          threshold: thresholds.tokenIncreasePercent,
          changePercent: tokenChange,
        },
        configVersion: current.configVersion,
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: RegressionAlert;
  onAcknowledge?: () => void;
}

function AlertCard({ alert, onAcknowledge }: AlertCardProps) {
  const severityConfig = {
    critical: {
      icon: AlertTriangle,
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
    },
    warning: {
      icon: AlertCircle,
      color: "text-yellow-500",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
    },
    info: {
      icon: TrendingDown,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/30",
    },
  };

  const config = severityConfig[alert.severity];
  const Icon = config.icon;

  const formatValue = useCallback(
    (value: number, metric: string): string => {
      switch (metric) {
        case "score":
        case "passRate":
          return `${(value * 100).toFixed(1)}%`;
        case "duration":
          return `${(value / 1000).toFixed(2)}s`;
        case "tokensUsed":
          return value.toLocaleString();
        default:
          return value.toString();
      }
    },
    []
  );

  return (
    <Card
      className={cn(
        "border",
        config.border,
        alert.acknowledged && "opacity-50"
      )}
    >
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded", config.bg)}>
              <Icon className={cn("h-4 w-4", config.color)} />
            </div>
            <div>
              <CardTitle className="text-sm">{alert.message}</CardTitle>
              <CardDescription className="text-xs">
                v{alert.configVersion} •{" "}
                {alert.detectedAt.toLocaleString()}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              alert.severity === "critical" && "border-red-500/50 text-red-500",
              alert.severity === "warning" &&
                "border-yellow-500/50 text-yellow-500",
              alert.severity === "info" && "border-blue-500/50 text-blue-500"
            )}
          >
            {alert.severity}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="py-2 px-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">
              Previous:{" "}
              <span className="font-mono">
                {formatValue(alert.details.previousValue, alert.details.metric)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Current:{" "}
              <span className={cn("font-mono", config.color)}>
                {formatValue(alert.details.currentValue, alert.details.metric)}
              </span>
            </span>
          </div>
          {onAcknowledge && !alert.acknowledged && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={onAcknowledge}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Acknowledge
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Threshold Settings Component
// ─────────────────────────────────────────────────────────────────────────────

interface ThresholdSettingsProps {
  thresholds: RegressionThresholds;
  onChange: (thresholds: RegressionThresholds) => void;
}

function ThresholdSettings({ thresholds, onChange }: ThresholdSettingsProps) {
  const handleChange = useCallback(
    <K extends keyof RegressionThresholds>(
      key: K,
      value: RegressionThresholds[K]
    ) => {
      onChange({ ...thresholds, [key]: value });
    },
    [thresholds, onChange]
  );

  return (
    <div className="space-y-4">
      {/* Score Drop */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm flex items-center gap-2">
            <Target className="h-3.5 w-3.5" />
            Score Drop Threshold
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {thresholds.scoreDropPercent}%
          </span>
        </div>
        <Slider
          value={[thresholds.scoreDropPercent]}
          onValueChange={([v]) => handleChange("scoreDropPercent", v)}
          min={1}
          max={50}
          step={1}
          className="w-full"
        />
      </div>

      {/* Duration Increase */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Duration Increase Threshold
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {thresholds.durationIncreasePercent}%
          </span>
        </div>
        <Slider
          value={[thresholds.durationIncreasePercent]}
          onValueChange={([v]) => handleChange("durationIncreasePercent", v)}
          min={5}
          max={100}
          step={5}
          className="w-full"
        />
      </div>

      {/* Pass Rate Drop */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Pass Rate Drop Threshold
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {thresholds.passRateDropPercent}%
          </span>
        </div>
        <Slider
          value={[thresholds.passRateDropPercent]}
          onValueChange={([v]) => handleChange("passRateDropPercent", v)}
          min={1}
          max={50}
          step={1}
          className="w-full"
        />
      </div>

      {/* Token Increase */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Token Increase Threshold
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {thresholds.tokenIncreasePercent}%
          </span>
        </div>
        <Slider
          value={[thresholds.tokenIncreasePercent]}
          onValueChange={([v]) => handleChange("tokenIncreasePercent", v)}
          min={10}
          max={100}
          step={5}
          className="w-full"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function RegressionDetector({
  history,
  alerts: externalAlerts,
  thresholds: externalThresholds,
  onThresholdsChange,
  onAcknowledgeAlert,
  monitoringEnabled = true,
  onToggleMonitoring,
  className,
}: RegressionDetectorProps) {
  // State
  const [thresholds, setThresholds] = useState<RegressionThresholds>(
    externalThresholds || DEFAULT_THRESHOLDS
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Detect regressions
  const detectedAlerts = useMemo(
    () => (monitoringEnabled ? detectRegressions(history, thresholds) : []),
    [history, thresholds, monitoringEnabled]
  );

  // Combine external and detected alerts
  const allAlerts = useMemo(() => {
    const combined = [...(externalAlerts || []), ...detectedAlerts];
    return combined.sort(
      (a, b) => b.detectedAt.getTime() - a.detectedAt.getTime()
    );
  }, [externalAlerts, detectedAlerts]);

  const unacknowledgedCount = allAlerts.filter((a) => !a.acknowledged).length;

  // Handle threshold change
  const handleThresholdsChange = useCallback(
    (newThresholds: RegressionThresholds) => {
      setThresholds(newThresholds);
      onThresholdsChange?.(newThresholds);
    },
    [onThresholdsChange]
  );

  // Stats
  const stats = useMemo(() => {
    const critical = allAlerts.filter((a) => a.severity === "critical" && !a.acknowledged).length;
    const warning = allAlerts.filter((a) => a.severity === "warning" && !a.acknowledged).length;
    const info = allAlerts.filter((a) => a.severity === "info" && !a.acknowledged).length;
    return { critical, warning, info };
  }, [allAlerts]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Regression Detector</h2>
          {unacknowledgedCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {unacknowledgedCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onToggleMonitoring && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Monitor</Label>
              <Switch
                checked={monitoringEnabled}
                onCheckedChange={onToggleMonitoring}
              />
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-4">
          {stats.critical > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-red-500">{stats.critical} critical</span>
            </div>
          )}
          {stats.warning > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-yellow-500">{stats.warning} warnings</span>
            </div>
          )}
          {stats.info > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <TrendingDown className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-blue-500">{stats.info} info</span>
            </div>
          )}
          {unacknowledgedCount === 0 && (
            <div className="flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All clear
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {history.length} data points
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Alerts List */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {allAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                  {monitoringEnabled ? (
                    <>
                      <Bell className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">No regressions detected</p>
                      <p className="text-xs mt-1">
                        Monitoring {history.length} benchmark runs
                      </p>
                    </>
                  ) : (
                    <>
                      <BellOff className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Monitoring disabled</p>
                      <p className="text-xs mt-1">
                        Enable monitoring to detect regressions
                      </p>
                    </>
                  )}
                </div>
              ) : (
                allAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={
                      onAcknowledgeAlert
                        ? () => onAcknowledgeAlert(alert.id)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Settings Panel */}
        <div className="w-[280px] border-l border-border overflow-hidden">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between px-4 py-2 h-auto"
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Thresholds</span>
                </div>
                {settingsOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 py-2">
                <ThresholdSettings
                  thresholds={thresholds}
                  onChange={handleThresholdsChange}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {!settingsOpen && (
            <div className="px-4 py-2 space-y-2">
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Current thresholds:</p>
                <div className="grid grid-cols-2 gap-1 font-mono">
                  <span>Score: {thresholds.scoreDropPercent}%</span>
                  <span>Duration: {thresholds.durationIncreasePercent}%</span>
                  <span>Pass Rate: {thresholds.passRateDropPercent}%</span>
                  <span>Tokens: {thresholds.tokenIncreasePercent}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RegressionDetector;
