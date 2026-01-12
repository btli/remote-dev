"use client";

/**
 * PromptPlayground - Interactive prompt testing and refinement interface
 *
 * Features per arXiv 2512.10398v5:
 * - Prompt editor with syntax highlighting
 * - Parameter tuning UI (temperature, max_tokens, etc.)
 * - Real-time feedback loop for iteration
 * - Validation for prompt templates
 * - Side-by-side comparison of outputs
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Play,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  History,
  GitCompare,
  Settings2,
  Trash2,
  Plus,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ParameterConfig {
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences: string[];
  presencePenalty: number;
  frequencyPenalty: number;
}

export interface TestRun {
  id: string;
  prompt: string;
  variables: Record<string, string>;
  parameters: ParameterConfig;
  output: string;
  error?: string;
  timing: {
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
    tokensPerSecond: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  status: "running" | "completed" | "failed";
}

interface PromptValidation {
  isValid: boolean;
  errors: Array<{
    type: "missing_variable" | "syntax" | "length";
    message: string;
    position?: { start: number; end: number };
  }>;
  warnings: Array<{
    type: "best_practice" | "performance";
    message: string;
  }>;
  extractedVariables: string[];
}

interface PromptPlaygroundProps {
  /** Initial prompt template */
  initialPrompt?: string;
  /** Initial parameters */
  initialParameters?: Partial<ParameterConfig>;
  /** Agent provider for context */
  agentProvider?: "claude" | "codex" | "gemini" | "opencode";
  /** Callback when prompt is saved */
  onSave?: (template: PromptTemplate) => void;
  /** Additional CSS class */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Parameters
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMETERS: ParameterConfig = {
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.95,
  topK: 40,
  stopSequences: [],
  presencePenalty: 0,
  frequencyPenalty: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation Utilities
// ─────────────────────────────────────────────────────────────────────────────

function validatePrompt(prompt: string): PromptValidation {
  const errors: PromptValidation["errors"] = [];
  const warnings: PromptValidation["warnings"] = [];

  // Extract variables ({{variable}} or {variable} syntax)
  const variablePattern = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g;
  const extractedVariables: string[] = [];
  let match;

  while ((match = variablePattern.exec(prompt)) !== null) {
    if (!extractedVariables.includes(match[1])) {
      extractedVariables.push(match[1]);
    }
  }

  // Check for unclosed braces
  const openBraces = (prompt.match(/\{/g) || []).length;
  const closeBraces = (prompt.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push({
      type: "syntax",
      message: "Unclosed braces detected in prompt template",
    });
  }

  // Check for empty prompt
  if (prompt.trim().length === 0) {
    errors.push({
      type: "length",
      message: "Prompt cannot be empty",
    });
  }

  // Best practice warnings
  if (prompt.length > 10000) {
    warnings.push({
      type: "performance",
      message: "Long prompts may increase latency and token costs",
    });
  }

  if (!prompt.includes("\n") && prompt.length > 500) {
    warnings.push({
      type: "best_practice",
      message: "Consider using line breaks to improve readability",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    extractedVariables,
  };
}

function interpolatePrompt(
  prompt: string,
  variables: Record<string, string>
): string {
  return prompt.replace(
    /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g,
    (_, varName) => variables[varName] || `{{${varName}}}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameter Tuner Component
// ─────────────────────────────────────────────────────────────────────────────

interface ParameterTunerProps {
  parameters: ParameterConfig;
  onChange: (params: ParameterConfig) => void;
}

function ParameterTuner({ parameters, onChange }: ParameterTunerProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [newStop, setNewStop] = useState("");

  const handleChange = useCallback(
    <K extends keyof ParameterConfig>(key: K, value: ParameterConfig[K]) => {
      onChange({ ...parameters, [key]: value });
    },
    [parameters, onChange]
  );

  const addStopSequence = useCallback(() => {
    if (newStop.trim() && !parameters.stopSequences.includes(newStop.trim())) {
      handleChange("stopSequences", [...parameters.stopSequences, newStop.trim()]);
      setNewStop("");
    }
  }, [newStop, parameters.stopSequences, handleChange]);

  const removeStopSequence = useCallback(
    (seq: string) => {
      handleChange(
        "stopSequences",
        parameters.stopSequences.filter((s) => s !== seq)
      );
    },
    [parameters.stopSequences, handleChange]
  );

  return (
    <div className="space-y-4">
      {/* Temperature */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Temperature</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {parameters.temperature.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[parameters.temperature]}
          onValueChange={([v]) => handleChange("temperature", v)}
          min={0}
          max={2}
          step={0.01}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Lower = more focused, Higher = more creative
        </p>
      </div>

      {/* Max Tokens */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Max Tokens</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {parameters.maxTokens.toLocaleString()}
          </span>
        </div>
        <Slider
          value={[parameters.maxTokens]}
          onValueChange={([v]) => handleChange("maxTokens", v)}
          min={1}
          max={128000}
          step={1}
          className="w-full"
        />
      </div>

      {/* Top P */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Top P (Nucleus Sampling)</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {parameters.topP.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[parameters.topP]}
          onValueChange={([v]) => handleChange("topP", v)}
          min={0}
          max={1}
          step={0.01}
          className="w-full"
        />
      </div>

      {/* Advanced Settings */}
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            {isAdvancedOpen ? (
              <ChevronDown className="h-4 w-4 mr-2" />
            ) : (
              <ChevronRight className="h-4 w-4 mr-2" />
            )}
            Advanced Settings
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          {/* Top K */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Top K</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {parameters.topK}
              </span>
            </div>
            <Slider
              value={[parameters.topK]}
              onValueChange={([v]) => handleChange("topK", v)}
              min={1}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          {/* Presence Penalty */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Presence Penalty</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {parameters.presencePenalty.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[parameters.presencePenalty]}
              onValueChange={([v]) => handleChange("presencePenalty", v)}
              min={-2}
              max={2}
              step={0.01}
              className="w-full"
            />
          </div>

          {/* Frequency Penalty */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Frequency Penalty</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {parameters.frequencyPenalty.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[parameters.frequencyPenalty]}
              onValueChange={([v]) => handleChange("frequencyPenalty", v)}
              min={-2}
              max={2}
              step={0.01}
              className="w-full"
            />
          </div>

          {/* Stop Sequences */}
          <div className="space-y-2">
            <Label className="text-sm">Stop Sequences</Label>
            <div className="flex gap-2">
              <Input
                value={newStop}
                onChange={(e) => setNewStop(e.target.value)}
                placeholder="Enter stop sequence..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && addStopSequence()}
              />
              <Button variant="outline" size="icon" onClick={addStopSequence}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {parameters.stopSequences.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {parameters.stopSequences.map((seq, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="cursor-pointer hover:bg-destructive/20"
                    onClick={() => removeStopSequence(seq)}
                  >
                    {seq.replace(/\n/g, "\\n")}
                    <Trash2 className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Run Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface TestRunCardProps {
  run: TestRun;
  isSelected?: boolean;
  onSelect?: () => void;
}

function TestRunCard({ run, isSelected, onSelect }: TestRunCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(run.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [run.output]);

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onSelect}
    >
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {run.status === "running" && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            {run.status === "completed" && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            {run.status === "failed" && (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm font-medium">
              {run.timing.completedAt.toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              <Clock className="h-2.5 w-2.5 mr-1" />
              {(run.timing.durationMs / 1000).toFixed(1)}s
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {run.usage.totalTokens.toLocaleString()} tokens
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="relative">
          <ScrollArea className="h-[120px]">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {run.error || run.output}
            </pre>
          </ScrollArea>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy();
                }}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy output</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function PromptPlayground({
  initialPrompt = "",
  initialParameters,
  agentProvider = "claude",
  onSave,
  className,
}: PromptPlaygroundProps) {
  // State
  const [prompt, setPrompt] = useState(initialPrompt);
  const [parameters, setParameters] = useState<ParameterConfig>({
    ...DEFAULT_PARAMETERS,
    ...initialParameters,
  });
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "history" | "compare">("editor");

  // Refs
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Validation
  const validation = useMemo(() => validatePrompt(prompt), [prompt]);

  // Update variables when prompt changes
  useEffect(() => {
    const newVariables: Record<string, string> = {};
    for (const varName of validation.extractedVariables) {
      newVariables[varName] = variables[varName] || "";
    }
    setVariables(newVariables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation.extractedVariables]);

  // Run test
  const runTest = useCallback(async () => {
    if (!validation.isValid) {
      toast.error("Please fix prompt errors before running");
      return;
    }

    setIsRunning(true);
    const runId = `run-${Date.now()}`;
    const interpolatedPrompt = interpolatePrompt(prompt, variables);

    // Add pending run
    const newRun: TestRun = {
      id: runId,
      prompt: interpolatedPrompt,
      variables: { ...variables },
      parameters: { ...parameters },
      output: "",
      timing: {
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        tokensPerSecond: 0,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      status: "running",
    };

    setTestRuns((prev) => [newRun, ...prev]);

    try {
      const response = await fetch("/api/sdk/meta/prompt-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: interpolatedPrompt,
          parameters,
          provider: agentProvider,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Test failed");
      }

      // Update run with results
      setTestRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                output: data.output,
                timing: {
                  ...run.timing,
                  completedAt: new Date(),
                  durationMs: data.durationMs || Date.now() - run.timing.startedAt.getTime(),
                  tokensPerSecond: data.tokensPerSecond || 0,
                },
                usage: {
                  inputTokens: data.usage?.inputTokens || 0,
                  outputTokens: data.usage?.outputTokens || 0,
                  totalTokens: data.usage?.totalTokens || 0,
                },
                status: "completed",
              }
            : run
        )
      );

      toast.success("Test completed");
    } catch (error) {
      setTestRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                error: error instanceof Error ? error.message : "Unknown error",
                timing: {
                  ...run.timing,
                  completedAt: new Date(),
                  durationMs: Date.now() - run.timing.startedAt.getTime(),
                  tokensPerSecond: 0,
                },
                status: "failed",
              }
            : run
        )
      );
      toast.error("Test failed");
    } finally {
      setIsRunning(false);
    }
  }, [prompt, variables, parameters, validation.isValid, agentProvider]);

  // Toggle run selection for comparison
  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      if (prev.includes(runId)) {
        return prev.filter((id) => id !== runId);
      }
      if (prev.length >= 2) {
        return [prev[1], runId];
      }
      return [...prev, runId];
    });
  }, []);

  // Clear history
  const clearHistory = useCallback(() => {
    setTestRuns([]);
    setSelectedRunIds([]);
    toast.success("History cleared");
  }, []);

  // Save template
  const handleSave = useCallback(() => {
    if (!validation.isValid) {
      toast.error("Please fix prompt errors before saving");
      return;
    }

    const template: PromptTemplate = {
      id: `template-${Date.now()}`,
      name: "Untitled Template",
      content: prompt,
      variables: validation.extractedVariables,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onSave?.(template);
    toast.success("Template saved");
  }, [prompt, validation, onSave]);

  // Get selected runs for comparison
  const selectedRuns = useMemo(
    () => testRuns.filter((run) => selectedRunIds.includes(run.id)),
    [testRuns, selectedRunIds]
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Prompt Playground</h2>
          <Badge variant="outline" className="text-xs">
            {agentProvider}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {onSave && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!validation.isValid}
            >
              <Save className="h-4 w-4 mr-2" />
              Save Template
            </Button>
          )}
          <Button
            size="sm"
            onClick={runTest}
            disabled={isRunning || !validation.isValid}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run Test
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Editor */}
        <div className="flex-1 flex flex-col border-r border-border overflow-hidden">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
            <TabsList className="mx-4 mt-2 w-fit">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="history" className="relative">
                History
                {testRuns.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center"
                  >
                    {testRuns.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="compare" disabled={selectedRuns.length < 2}>
                Compare
                {selectedRuns.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center"
                  >
                    {selectedRuns.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="flex-1 flex flex-col p-4 space-y-4 overflow-auto">
              {/* Prompt Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Prompt Template</Label>
                  {validation.extractedVariables.length > 0 && (
                    <div className="flex items-center gap-1">
                      {validation.extractedVariables.map((v) => (
                        <Badge key={v} variant="outline" className="text-[10px]">
                          {`{{${v}}}`}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Enter your prompt template here. Use {{variable}} syntax for dynamic values."
                  className="min-h-[200px] font-mono text-sm resize-y"
                />

                {/* Validation Messages */}
                {(validation.errors.length > 0 || validation.warnings.length > 0) && (
                  <div className="space-y-1">
                    {validation.errors.map((error, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-red-500">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {error.message}
                      </div>
                    ))}
                    {validation.warnings.map((warning, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-yellow-500">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {warning.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Variables */}
              {validation.extractedVariables.length > 0 && (
                <div className="space-y-2">
                  <Label>Variables</Label>
                  <div className="grid gap-2">
                    {validation.extractedVariables.map((varName) => (
                      <div key={varName} className="flex items-center gap-2">
                        <Label className="w-32 text-sm text-muted-foreground">
                          {varName}
                        </Label>
                        <Input
                          value={variables[varName] || ""}
                          onChange={(e) =>
                            setVariables((prev) => ({
                              ...prev,
                              [varName]: e.target.value,
                            }))
                          }
                          placeholder={`Value for ${varName}`}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview */}
              {Object.values(variables).some((v) => v) && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Preview</Label>
                  <div className="p-3 rounded-md bg-muted/30 border border-border">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {interpolatePrompt(prompt, variables)}
                    </pre>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="flex-1 flex flex-col p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <Label>Test History</Label>
                {testRuns.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearHistory}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-3 pr-4">
                  {testRuns.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No test runs yet</p>
                      <p className="text-xs mt-1">Run a test to see results here</p>
                    </div>
                  ) : (
                    testRuns.map((run) => (
                      <TestRunCard
                        key={run.id}
                        run={run}
                        isSelected={selectedRunIds.includes(run.id)}
                        onSelect={() => toggleRunSelection(run.id)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
              {selectedRuns.length === 1 && (
                <div className="mt-2 text-center text-sm text-muted-foreground">
                  Select one more run to compare
                </div>
              )}
            </TabsContent>

            <TabsContent value="compare" className="flex-1 flex flex-col p-4 overflow-hidden">
              {selectedRuns.length < 2 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <GitCompare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Select 2 runs to compare</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
                  {selectedRuns.map((run, index) => (
                    <div key={run.id} className="flex flex-col overflow-hidden">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={index === 0 ? "default" : "secondary"}>
                          Run {index + 1}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {run.timing.completedAt.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                        <span>T: {run.parameters.temperature}</span>
                        <span>Tokens: {run.usage.totalTokens}</span>
                        <span>{(run.timing.durationMs / 1000).toFixed(1)}s</span>
                      </div>
                      <ScrollArea className="flex-1 border border-border rounded-md">
                        <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                          {run.output}
                        </pre>
                      </ScrollArea>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel - Parameters */}
        <div className="w-[300px] flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Parameters</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4">
              <ParameterTuner
                parameters={parameters}
                onChange={setParameters}
              />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

export default PromptPlayground;
