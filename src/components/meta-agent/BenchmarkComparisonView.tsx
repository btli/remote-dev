"use client";

/**
 * BenchmarkComparisonView - Side-by-side config and benchmark comparison
 *
 * Features per arXiv 2512.10398v5:
 * - Side-by-side config comparison
 * - Historical improvement charts
 * - A/B testing framework for configs
 * - Iteration history timeline
 */

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  BarChart3,
  GitCompare,
  History,
  Target,
  RefreshCw,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BenchmarkRun {
  id: string;
  configId: string;
  configVersion: number;
  score: number;
  passed: boolean;
  executedAt: Date;
  durationMs: number;
  testResults: Array<{
    testCaseId: string;
    name: string;
    passed: boolean;
    score: number;
    durationMs: number;
    error?: string;
  }>;
  metrics: {
    tokensUsed: number;
    apiCalls: number;
    retries: number;
  };
}

export interface ConfigVersion {
  id: string;
  version: number;
  name: string;
  createdAt: Date;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  benchmarkRuns: BenchmarkRun[];
}

interface BenchmarkComparisonViewProps {
  /** Config versions to compare */
  configs: ConfigVersion[];
  /** Currently selected config IDs for comparison */
  selectedConfigIds?: [string, string];
  /** Callback when config selection changes */
  onSelectionChange?: (ids: [string, string]) => void;
  /** Callback to run a new benchmark */
  onRunBenchmark?: (configId: string) => Promise<void>;
  /** Additional CSS class */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function calculateImprovement(oldScore: number, newScore: number): {
  value: number;
  direction: "up" | "down" | "same";
  percentage: number;
} {
  if (oldScore === newScore) {
    return { value: 0, direction: "same", percentage: 0 };
  }

  const diff = newScore - oldScore;
  const percentage = oldScore > 0 ? (diff / oldScore) * 100 : 0;

  return {
    value: Math.abs(diff),
    direction: diff > 0 ? "up" : "down",
    percentage: Math.abs(percentage),
  };
}

function getScoreColor(score: number): string {
  if (score >= 0.9) return "text-green-500";
  if (score >= 0.7) return "text-yellow-500";
  if (score >= 0.5) return "text-orange-500";
  return "text-red-500";
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  valueA: number | string;
  valueB: number | string;
  format?: "number" | "percentage" | "duration" | "string";
  higherIsBetter?: boolean;
}

function MetricCard({
  label,
  valueA,
  valueB,
  format = "number",
  higherIsBetter = true,
}: MetricCardProps) {
  const formatValue = useCallback(
    (value: number | string): string => {
      if (typeof value === "string") return value;
      switch (format) {
        case "percentage":
          return `${(value * 100).toFixed(1)}%`;
        case "duration":
          return `${(value / 1000).toFixed(2)}s`;
        default:
          return value.toLocaleString();
      }
    },
    [format]
  );

  const numA = typeof valueA === "number" ? valueA : 0;
  const numB = typeof valueB === "number" ? valueB : 0;
  const improvement = calculateImprovement(numA, numB);

  const isImproved =
    (higherIsBetter && improvement.direction === "up") ||
    (!higherIsBetter && improvement.direction === "down");

  return (
    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-mono">{formatValue(valueA)}</span>
        <div className="flex items-center gap-1">
          {improvement.direction === "up" && (
            <ArrowUp
              className={cn(
                "h-3.5 w-3.5",
                isImproved ? "text-green-500" : "text-red-500"
              )}
            />
          )}
          {improvement.direction === "down" && (
            <ArrowDown
              className={cn(
                "h-3.5 w-3.5",
                isImproved ? "text-green-500" : "text-red-500"
              )}
            />
          )}
          {improvement.direction === "same" && (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <span className="text-sm font-mono">{formatValue(valueB)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Score History Chart (Simple ASCII-style)
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreHistoryProps {
  runs: BenchmarkRun[];
  maxRuns?: number;
}

function ScoreHistory({ runs, maxRuns = 10 }: ScoreHistoryProps) {
  const sortedRuns = useMemo(
    () =>
      [...runs]
        .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime())
        .slice(-maxRuns),
    [runs, maxRuns]
  );

  if (sortedRuns.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4 text-sm">
        No benchmark history
      </div>
    );
  }

  const maxScore = Math.max(...sortedRuns.map((r) => r.score), 1);
  const minScore = Math.min(...sortedRuns.map((r) => r.score), 0);
  const range = maxScore - minScore || 1;

  return (
    <div className="space-y-2">
      {/* Chart */}
      <div className="flex items-end gap-1 h-24 bg-muted/20 rounded-md p-2">
        {sortedRuns.map((run) => {
          const height = ((run.score - minScore) / range) * 100;
          return (
            <Tooltip key={run.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex-1 rounded-t transition-all cursor-pointer hover:opacity-80",
                    run.passed
                      ? "bg-green-500/70"
                      : "bg-red-500/70"
                  )}
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-medium">
                    Score: {(run.score * 100).toFixed(1)}%
                  </p>
                  <p className="text-muted-foreground">
                    {run.executedAt.toLocaleDateString()}
                  </p>
                  <p className="text-muted-foreground">
                    v{run.configVersion}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{sortedRuns[0]?.executedAt.toLocaleDateString()}</span>
        <span>{sortedRuns[sortedRuns.length - 1]?.executedAt.toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Case Comparison Table
// ─────────────────────────────────────────────────────────────────────────────

interface TestCaseComparisonProps {
  runA: BenchmarkRun;
  runB: BenchmarkRun;
}

function TestCaseComparison({ runA, runB }: TestCaseComparisonProps) {
  // Merge test cases from both runs
  const allTestCaseIds = useMemo(() => {
    const ids = new Set<string>();
    runA.testResults.forEach((r) => ids.add(r.testCaseId));
    runB.testResults.forEach((r) => ids.add(r.testCaseId));
    return Array.from(ids);
  }, [runA, runB]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 text-xs font-medium text-muted-foreground px-2">
        <span>Test Case</span>
        <span className="text-center">Config A</span>
        <span className="text-center">Config B</span>
        <span className="text-center">Score Δ</span>
        <span className="text-center">Duration Δ</span>
      </div>

      {/* Rows */}
      <ScrollArea className="h-[300px]">
        <div className="space-y-1">
          {allTestCaseIds.map((testId) => {
            const resultA = runA.testResults.find((r) => r.testCaseId === testId);
            const resultB = runB.testResults.find((r) => r.testCaseId === testId);
            const name = resultA?.name || resultB?.name || testId;

            const scoreA = resultA?.score ?? 0;
            const scoreB = resultB?.score ?? 0;
            const scoreImprovement = calculateImprovement(scoreA, scoreB);

            const durationA = resultA?.durationMs ?? 0;
            const durationB = resultB?.durationMs ?? 0;
            const durationImprovement = calculateImprovement(durationA, durationB);

            return (
              <div
                key={testId}
                className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted/30"
              >
                <span className="truncate">{name}</span>

                {/* Config A Status */}
                <div className="flex items-center justify-center">
                  {resultA ? (
                    resultA.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Config B Status */}
                <div className="flex items-center justify-center">
                  {resultB ? (
                    resultB.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Score Delta */}
                <div className="flex items-center justify-center gap-1">
                  {scoreImprovement.direction === "up" && (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  )}
                  {scoreImprovement.direction === "down" && (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-mono",
                      scoreImprovement.direction === "up" && "text-green-500",
                      scoreImprovement.direction === "down" && "text-red-500"
                    )}
                  >
                    {scoreImprovement.percentage > 0
                      ? `${scoreImprovement.percentage.toFixed(0)}%`
                      : "-"}
                  </span>
                </div>

                {/* Duration Delta */}
                <div className="flex items-center justify-center gap-1">
                  {durationImprovement.direction === "up" && (
                    <ArrowUp className="h-3 w-3 text-red-500" />
                  )}
                  {durationImprovement.direction === "down" && (
                    <ArrowDown className="h-3 w-3 text-green-500" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-mono",
                      durationImprovement.direction === "down" && "text-green-500",
                      durationImprovement.direction === "up" && "text-red-500"
                    )}
                  >
                    {durationImprovement.value > 0
                      ? `${(durationImprovement.value / 1000).toFixed(1)}s`
                      : "-"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function BenchmarkComparisonView({
  configs,
  selectedConfigIds,
  onSelectionChange,
  onRunBenchmark,
  className,
}: BenchmarkComparisonViewProps) {
  // State
  const [configA, setConfigA] = useState<string>(
    selectedConfigIds?.[0] || configs[0]?.id || ""
  );
  const [configB, setConfigB] = useState<string>(
    selectedConfigIds?.[1] || configs[1]?.id || ""
  );
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "tests" | "history">("summary");

  // Get selected configs
  const selectedA = useMemo(
    () => configs.find((c) => c.id === configA),
    [configs, configA]
  );
  const selectedB = useMemo(
    () => configs.find((c) => c.id === configB),
    [configs, configB]
  );

  // Get latest runs
  const latestRunA = useMemo(
    () =>
      selectedA?.benchmarkRuns
        .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0],
    [selectedA]
  );
  const latestRunB = useMemo(
    () =>
      selectedB?.benchmarkRuns
        .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0],
    [selectedB]
  );

  // Handle config selection
  const handleConfigAChange = useCallback(
    (value: string) => {
      setConfigA(value);
      onSelectionChange?.([value, configB]);
    },
    [configB, onSelectionChange]
  );

  const handleConfigBChange = useCallback(
    (value: string) => {
      setConfigB(value);
      onSelectionChange?.([configA, value]);
    },
    [configA, onSelectionChange]
  );

  // Handle run benchmark
  const handleRunBenchmark = useCallback(
    async (configId: string) => {
      if (!onRunBenchmark) return;
      setIsRunning(configId);
      try {
        await onRunBenchmark(configId);
      } finally {
        setIsRunning(null);
      }
    },
    [onRunBenchmark]
  );

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    if (!latestRunA || !latestRunB) return null;

    const passRateA =
      latestRunA.testResults.filter((r) => r.passed).length /
      latestRunA.testResults.length;
    const passRateB =
      latestRunB.testResults.filter((r) => r.passed).length /
      latestRunB.testResults.length;

    return {
      scoreImprovement: calculateImprovement(latestRunA.score, latestRunB.score),
      passRateA: passRateA * 100,
      passRateB: passRateB * 100,
      durationA: latestRunA.durationMs,
      durationB: latestRunB.durationMs,
      tokensA: latestRunA.metrics.tokensUsed,
      tokensB: latestRunB.metrics.tokensUsed,
    };
  }, [latestRunA, latestRunB]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header with Config Selectors */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Benchmark Comparison</h2>
        </div>
      </div>

      {/* Config Selectors */}
      <div className="grid grid-cols-2 gap-4 p-4 border-b border-border">
        {/* Config A */}
        <Card>
          <CardHeader className="py-2 px-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline">Config A</Badge>
              {onRunBenchmark && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRunBenchmark(configA)}
                  disabled={isRunning !== null}
                >
                  {isRunning === configA ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="py-2 px-3">
            <Select value={configA} onValueChange={handleConfigAChange}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select config..." />
              </SelectTrigger>
              <SelectContent>
                {configs.map((config) => (
                  <SelectItem key={config.id} value={config.id}>
                    {config.name} (v{config.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {latestRunA && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "font-medium",
                    getScoreColor(latestRunA.score)
                  )}
                >
                  {(latestRunA.score * 100).toFixed(1)}%
                </span>
                <span>•</span>
                <span>{latestRunA.executedAt.toLocaleDateString()}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Config B */}
        <Card>
          <CardHeader className="py-2 px-3">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">Config B</Badge>
              {onRunBenchmark && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRunBenchmark(configB)}
                  disabled={isRunning !== null}
                >
                  {isRunning === configB ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="py-2 px-3">
            <Select value={configB} onValueChange={handleConfigBChange}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select config..." />
              </SelectTrigger>
              <SelectContent>
                {configs.map((config) => (
                  <SelectItem key={config.id} value={config.id}>
                    {config.name} (v{config.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {latestRunB && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "font-medium",
                    getScoreColor(latestRunB.score)
                  )}
                >
                  {(latestRunB.score * 100).toFixed(1)}%
                </span>
                <span>•</span>
                <span>{latestRunB.executedAt.toLocaleDateString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex-1 flex flex-col h-full"
        >
          <TabsList className="mx-4 mt-2 w-fit">
            <TabsTrigger value="summary">
              <BarChart3 className="h-4 w-4 mr-2" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="tests">
              <Target className="h-4 w-4 mr-2" />
              Test Cases
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>

          {/* Summary Tab */}
          <TabsContent value="summary" className="flex-1 p-4 overflow-auto">
            {summaryStats && latestRunA && latestRunB ? (
              <div className="space-y-6">
                {/* Score Comparison */}
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Score Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-muted-foreground">
                          {(latestRunA.score * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">Config A</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {summaryStats.scoreImprovement.direction === "up" && (
                          <TrendingUp className="h-6 w-6 text-green-500" />
                        )}
                        {summaryStats.scoreImprovement.direction === "down" && (
                          <TrendingDown className="h-6 w-6 text-red-500" />
                        )}
                        <span
                          className={cn(
                            "text-lg font-bold",
                            summaryStats.scoreImprovement.direction === "up" &&
                              "text-green-500",
                            summaryStats.scoreImprovement.direction === "down" &&
                              "text-red-500"
                          )}
                        >
                          {summaryStats.scoreImprovement.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">
                          {(latestRunB.score * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">Config B</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Metrics Grid */}
                <div className="space-y-2">
                  <MetricCard
                    label="Pass Rate"
                    valueA={summaryStats.passRateA / 100}
                    valueB={summaryStats.passRateB / 100}
                    format="percentage"
                  />
                  <MetricCard
                    label="Duration"
                    valueA={summaryStats.durationA}
                    valueB={summaryStats.durationB}
                    format="duration"
                    higherIsBetter={false}
                  />
                  <MetricCard
                    label="Tokens Used"
                    valueA={summaryStats.tokensA}
                    valueB={summaryStats.tokensB}
                    higherIsBetter={false}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select configs with benchmark runs to compare</p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Test Cases Tab */}
          <TabsContent value="tests" className="flex-1 p-4 overflow-hidden">
            {latestRunA && latestRunB ? (
              <TestCaseComparison runA={latestRunA} runB={latestRunB} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No benchmark runs to compare</p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="flex-1 p-4 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Config A History</CardTitle>
                  <CardDescription>
                    {selectedA?.name} (v{selectedA?.version})
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScoreHistory runs={selectedA?.benchmarkRuns || []} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Config B History</CardTitle>
                  <CardDescription>
                    {selectedB?.name} (v{selectedB?.version})
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScoreHistory runs={selectedB?.benchmarkRuns || []} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default BenchmarkComparisonView;
