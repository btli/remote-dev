/**
 * SDK Meta-Agent API Routes
 *
 * Provides endpoints for the meta-agent configuration optimization system.
 * Maps to BUILD → TEST → IMPROVE loop operations.
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";

// Meta-agent types (mirroring Rust SDK types)
export interface TaskSpec {
  id: string;
  taskType: "feature" | "bugfix" | "refactor" | "test" | "docs" | "review";
  description: string;
  acceptanceCriteria: string[];
  complexity?: number;
  relevantFiles: string[];
  constraints: string[];
  beadsIssueId?: string;
}

export interface ProjectContext {
  projectPath: string;
  projectType: string;
  language: string;
  frameworks: string[];
  packageManager: string;
  testFramework?: string;
  linter?: string;
  hasCi: boolean;
  currentBranch?: string;
  folderId?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  provider: "claude" | "codex" | "gemini" | "opencode";
  taskSpec: TaskSpec;
  projectContext: ProjectContext;
  systemPrompt: string;
  instructionsFile: string;
  version: number;
  createdAt: string;
}

export interface OptimizationOptions {
  maxIterations?: number;
  targetScore?: number;
  minImprovement?: number;
  timeoutSeconds?: number;
  verbose?: boolean;
  dryRun?: boolean;
}

export interface OptimizationSnapshot {
  iteration: number;
  score: number;
  configVersion: number;
  suggestionsApplied: number;
  iterationDurationMs: number;
}

export interface OptimizationResult {
  config: AgentConfig;
  iterations: number;
  finalScore: number;
  scoreHistory: number[];
  iterationHistory: OptimizationSnapshot[];
  totalDurationMs: number;
  reachedTarget: boolean;
  stopReason: "target_reached" | "max_iterations" | "no_improvement" | "timeout" | "error";
}

// Simple in-memory store for optimization results (in production, use database)
const optimizationResults = new Map<string, OptimizationResult>();

/**
 * POST /api/sdk/meta - Run optimization
 *
 * Runs the BUILD → TEST → IMPROVE loop on the provided task and context.
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { task, context, options } = body as {
      task: TaskSpec;
      context: ProjectContext;
      options?: OptimizationOptions;
    };

    // Validate required fields
    if (!task || !context) {
      return NextResponse.json(
        { error: "task and context are required" },
        { status: 400 }
      );
    }

    if (!task.id || !task.taskType || !task.description) {
      return NextResponse.json(
        { error: "task must have id, taskType, and description" },
        { status: 400 }
      );
    }

    if (!context.projectPath || !context.language) {
      return NextResponse.json(
        { error: "context must have projectPath and language" },
        { status: 400 }
      );
    }

    // Resolve options with defaults
    const opts: Required<OptimizationOptions> = {
      maxIterations: options?.maxIterations ?? 3,
      targetScore: options?.targetScore ?? 0.9,
      minImprovement: options?.minImprovement ?? 0.05,
      timeoutSeconds: options?.timeoutSeconds ?? 600,
      verbose: options?.verbose ?? false,
      dryRun: options?.dryRun ?? false,
    };

    // Simulate optimization (in production, call Rust SDK via WASM or gRPC)
    const startTime = Date.now();
    const scoreHistory: number[] = [];
    const iterationHistory: OptimizationSnapshot[] = [];

    // BUILD: Generate initial config
    const config = generateConfig(task, context, "claude", 1);

    // Simulate iterations
    let currentScore = 0.5 + Math.random() * 0.2; // Start with 0.5-0.7
    let currentConfig = config;

    for (let i = 1; i <= opts.maxIterations; i++) {
      const iterStart = Date.now();

      // TEST: Evaluate
      scoreHistory.push(currentScore);

      // Record snapshot
      iterationHistory.push({
        iteration: i,
        score: currentScore,
        configVersion: currentConfig.version,
        suggestionsApplied: Math.floor(Math.random() * 3),
        iterationDurationMs: Date.now() - iterStart,
      });

      // Check target
      if (currentScore >= opts.targetScore) {
        const result: OptimizationResult = {
          config: currentConfig,
          iterations: i,
          finalScore: currentScore,
          scoreHistory,
          iterationHistory,
          totalDurationMs: Date.now() - startTime,
          reachedTarget: true,
          stopReason: "target_reached",
        };

        // Store result
        const resultId = `opt-${userId}-${Date.now()}`;
        optimizationResults.set(resultId, result);

        return NextResponse.json({
          resultId,
          ...result,
        });
      }

      // IMPROVE: Refine config
      currentScore += 0.1 + Math.random() * 0.1; // Improve by 0.1-0.2
      currentConfig = {
        ...currentConfig,
        version: currentConfig.version + 1,
        systemPrompt: currentConfig.systemPrompt + "\n\n// Iteration " + i + " improvements",
      };
    }

    // Max iterations reached
    const result: OptimizationResult = {
      config: currentConfig,
      iterations: opts.maxIterations,
      finalScore: currentScore,
      scoreHistory,
      iterationHistory,
      totalDurationMs: Date.now() - startTime,
      reachedTarget: false,
      stopReason: "max_iterations",
    };

    const resultId = `opt-${userId}-${Date.now()}`;
    optimizationResults.set(resultId, result);

    return NextResponse.json({
      resultId,
      ...result,
    });
  } catch (error) {
    console.error("Failed to run optimization:", error);
    return NextResponse.json(
      { error: "Failed to run optimization" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/meta - List optimization results
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const resultId = url.searchParams.get("resultId");

    if (resultId) {
      // Get specific result
      const result = optimizationResults.get(resultId);
      if (!result) {
        return NextResponse.json(
          { error: "Optimization result not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(result);
    }

    // List all results for user (filter by userId prefix)
    const userResults: Array<{ resultId: string; result: OptimizationResult }> = [];
    for (const [id, result] of Array.from(optimizationResults.entries())) {
      if (id.includes(`-${userId}-`)) {
        userResults.push({ resultId: id, result });
      }
    }

    return NextResponse.json({
      results: userResults.slice(0, 50), // Limit to 50
      total: userResults.length,
    });
  } catch (error) {
    console.error("Failed to query optimization results:", error);
    return NextResponse.json(
      { error: "Failed to query optimization results" },
      { status: 500 }
    );
  }
});

// Helper: Generate config based on task and context
function generateConfig(
  task: TaskSpec,
  context: ProjectContext,
  provider: AgentConfig["provider"],
  version: number
): AgentConfig {
  const systemPrompt = generateSystemPrompt(task, context, provider);
  const instructionsFile = generateInstructionsFile(task, context, provider);

  return {
    id: `config-${Date.now()}`,
    name: `Config for ${task.description}`,
    provider,
    taskSpec: task,
    projectContext: context,
    systemPrompt,
    instructionsFile,
    version,
    createdAt: new Date().toISOString(),
  };
}

function generateSystemPrompt(
  task: TaskSpec,
  context: ProjectContext,
  provider: AgentConfig["provider"]
): string {
  const base = `You are working on a ${context.projectType} project using ${context.language}.

Task: ${task.description}
Type: ${task.taskType}

Follow best practices for ${context.language} development.`;

  // Provider-specific additions
  switch (provider) {
    case "claude":
      return base + "\n\nUse your reasoning capabilities to plan before implementing.";
    case "codex":
      return base + "\n\nGenerate efficient, well-tested code.";
    case "gemini":
      return base + "\n\nAnalyze the problem thoroughly before coding.";
    case "opencode":
      return base + "\n\nFollow OpenCode conventions and patterns.";
    default:
      return base;
  }
}

function generateInstructionsFile(
  task: TaskSpec,
  context: ProjectContext,
  provider: AgentConfig["provider"]
): string {
  let content = `# Project: ${context.projectPath}

## Task
${task.description}

`;

  if (task.acceptanceCriteria.length > 0) {
    content += "## Acceptance Criteria\n";
    for (const criterion of task.acceptanceCriteria) {
      content += `- ${criterion}\n`;
    }
    content += "\n";
  }

  if (task.constraints.length > 0) {
    content += "## Constraints\n";
    for (const constraint of task.constraints) {
      content += `- ${constraint}\n`;
    }
    content += "\n";
  }

  if (task.relevantFiles.length > 0) {
    content += "## Relevant Files\n";
    for (const file of task.relevantFiles) {
      content += `- ${file}\n`;
    }
  }

  return content;
}
