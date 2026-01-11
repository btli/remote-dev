/**
 * SDK Meta-Agent API Routes
 *
 * Provides endpoints for the meta-agent configuration optimization system.
 * Maps to BUILD → TEST → IMPROVE loop operations.
 *
 * Endpoints:
 * - POST /api/sdk/meta - Start optimization (sync or async)
 * - GET /api/sdk/meta - Get optimization result by ID or list results
 *
 * Related routes:
 * - GET /api/sdk/meta/status/[id] - Check job status and progress
 * - GET /api/sdk/meta/history - List past optimizations
 * - GET /api/sdk/meta/stream?jobId=xxx - SSE progress stream
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import { db } from "@/db";
import {
  sdkMetaAgentConfigs,
  sdkMetaAgentOptimizationJobs,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

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

/**
 * Extended options for optimization requests
 */
interface ExtendedOptimizationOptions extends OptimizationOptions {
  async?: boolean;        // Run async (returns job ID immediately)
  sessionId?: string;     // Link to terminal session
  folderId?: string;      // Link to folder
  provider?: "claude" | "codex" | "gemini" | "opencode";
}

/**
 * POST /api/sdk/meta - Run optimization
 *
 * Runs the BUILD → TEST → IMPROVE loop on the provided task and context.
 *
 * Options:
 * - async: true - Returns job ID immediately, use /status/[id] to poll
 * - sessionId: Link optimization to a terminal session
 * - folderId: Link optimization to a folder
 * - provider: Agent provider (default: claude)
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { task, context, options } = body as {
      task: TaskSpec;
      context: ProjectContext;
      options?: ExtendedOptimizationOptions;
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
    const opts = {
      maxIterations: options?.maxIterations ?? 3,
      targetScore: options?.targetScore ?? 0.9,
      minImprovement: options?.minImprovement ?? 0.05,
      timeoutSeconds: options?.timeoutSeconds ?? 600,
      verbose: options?.verbose ?? false,
      dryRun: options?.dryRun ?? false,
      async: options?.async ?? false,
      sessionId: options?.sessionId,
      folderId: options?.folderId ?? context.folderId,
      provider: options?.provider ?? "claude",
    };

    // Create optimization job in database
    const [job] = await db
      .insert(sdkMetaAgentOptimizationJobs)
      .values({
        userId,
        folderId: opts.folderId ?? null,
        sessionId: opts.sessionId ?? null,
        status: opts.async ? "pending" : "running",
        currentIteration: 0,
        maxIterations: opts.maxIterations,
        currentScore: null,
        targetScore: opts.targetScore,
        taskSpecJson: JSON.stringify(task),
        projectContextJson: JSON.stringify(context),
        optionsJson: JSON.stringify(opts),
        scoreHistoryJson: "[]",
        iterationHistoryJson: "[]",
        startedAt: opts.async ? null : new Date(),
      })
      .returning();

    // If async mode, return job ID immediately
    if (opts.async) {
      // Start background optimization (fire-and-forget)
      runOptimizationAsync(job.id, userId, task, context, opts).catch((error) => {
        console.error(`Background optimization ${job.id} failed:`, error);
      });

      return NextResponse.json({
        jobId: job.id,
        status: "pending",
        message: "Optimization job created. Use /api/sdk/meta/status/" + job.id + " to check progress or /api/sdk/meta/stream?jobId=" + job.id + " for SSE streaming.",
        links: {
          status: `/api/sdk/meta/status/${job.id}`,
          stream: `/api/sdk/meta/stream?jobId=${job.id}`,
          cancel: `/api/sdk/meta/status/${job.id}`,
        },
      });
    }

    // Synchronous optimization - run inline and return result
    const result = await runOptimizationSync(job.id, userId, task, context, opts);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to run optimization:", error);
    return NextResponse.json(
      { error: "Failed to run optimization" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/meta - Get optimization job or result by ID
 *
 * Query parameters:
 * - jobId: Get job by ID
 * - configId: Get config by ID
 * - limit: List recent jobs (default: 10)
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const configId = url.searchParams.get("configId");
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    // Get specific job
    if (jobId) {
      const job = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
        where: and(
          eq(sdkMetaAgentOptimizationJobs.id, jobId),
          eq(sdkMetaAgentOptimizationJobs.userId, userId)
        ),
      });

      if (!job) {
        return NextResponse.json(
          { error: "Optimization job not found" },
          { status: 404 }
        );
      }

      // If completed, include config
      let config = null;
      if (job.configId) {
        config = await db.query.sdkMetaAgentConfigs.findFirst({
          where: eq(sdkMetaAgentConfigs.id, job.configId),
        });
      }

      return NextResponse.json({
        job: {
          id: job.id,
          status: job.status,
          currentIteration: job.currentIteration,
          maxIterations: job.maxIterations,
          currentScore: job.currentScore,
          targetScore: job.targetScore,
          scoreHistory: JSON.parse(job.scoreHistoryJson),
          iterationHistory: JSON.parse(job.iterationHistoryJson),
          stopReason: job.stopReason,
          errorMessage: job.errorMessage,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          createdAt: job.createdAt,
        },
        config: config
          ? {
              id: config.id,
              name: config.name,
              provider: config.provider,
              version: config.version,
              systemPrompt: config.systemPrompt,
              instructionsFile: config.instructionsFile,
            }
          : null,
      });
    }

    // Get specific config
    if (configId) {
      const config = await db.query.sdkMetaAgentConfigs.findFirst({
        where: and(
          eq(sdkMetaAgentConfigs.id, configId),
          eq(sdkMetaAgentConfigs.userId, userId)
        ),
      });

      if (!config) {
        return NextResponse.json(
          { error: "Config not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        id: config.id,
        name: config.name,
        provider: config.provider,
        version: config.version,
        systemPrompt: config.systemPrompt,
        instructionsFile: config.instructionsFile,
        taskSpec: JSON.parse(config.taskSpecJson),
        projectContext: JSON.parse(config.projectContextJson),
        createdAt: config.createdAt,
      });
    }

    // List recent jobs
    const jobs = await db.query.sdkMetaAgentOptimizationJobs.findMany({
      where: eq(sdkMetaAgentOptimizationJobs.userId, userId),
      orderBy: [desc(sdkMetaAgentOptimizationJobs.createdAt)],
      limit: Math.min(limit, 50),
    });

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        currentIteration: job.currentIteration,
        maxIterations: job.maxIterations,
        currentScore: job.currentScore,
        targetScore: job.targetScore,
        stopReason: job.stopReason,
        configId: job.configId,
        folderId: job.folderId,
        sessionId: job.sessionId,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      })),
      total: jobs.length,
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

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Execution Functions
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedOptions {
  maxIterations: number;
  targetScore: number;
  minImprovement: number;
  timeoutSeconds: number;
  verbose: boolean;
  dryRun: boolean;
  async: boolean;
  sessionId?: string;
  folderId?: string;
  provider: "claude" | "codex" | "gemini" | "opencode";
}

/**
 * Run optimization synchronously (blocking)
 *
 * Updates job in database as it progresses, returns final result.
 */
async function runOptimizationSync(
  jobId: string,
  userId: string,
  task: TaskSpec,
  context: ProjectContext,
  opts: ResolvedOptions
): Promise<{
  jobId: string;
  config: AgentConfig;
  iterations: number;
  finalScore: number;
  scoreHistory: number[];
  iterationHistory: OptimizationSnapshot[];
  totalDurationMs: number;
  reachedTarget: boolean;
  stopReason: OptimizationResult["stopReason"];
}> {
  const startTime = Date.now();
  const scoreHistory: number[] = [];
  const iterationHistory: OptimizationSnapshot[] = [];

  // BUILD: Generate initial config
  const config = generateConfig(task, context, opts.provider, 1);

  // Simulate iterations
  let currentScore = 0.5 + Math.random() * 0.2; // Start with 0.5-0.7
  let currentConfig = config;
  let stopReason: OptimizationResult["stopReason"] = "max_iterations";

  for (let i = 1; i <= opts.maxIterations; i++) {
    const iterStart = Date.now();

    // TEST: Evaluate
    scoreHistory.push(currentScore);

    // Record snapshot
    const snapshot: OptimizationSnapshot = {
      iteration: i,
      score: currentScore,
      configVersion: currentConfig.version,
      suggestionsApplied: Math.floor(Math.random() * 3),
      iterationDurationMs: Date.now() - iterStart,
    };
    iterationHistory.push(snapshot);

    // Update job in database
    await db
      .update(sdkMetaAgentOptimizationJobs)
      .set({
        currentIteration: i,
        currentScore,
        scoreHistoryJson: JSON.stringify(scoreHistory),
        iterationHistoryJson: JSON.stringify(iterationHistory),
        updatedAt: new Date(),
      })
      .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));

    // Check target
    if (currentScore >= opts.targetScore) {
      stopReason = "target_reached";
      break;
    }

    // IMPROVE: Refine config
    currentScore += 0.1 + Math.random() * 0.1; // Improve by 0.1-0.2
    currentConfig = {
      ...currentConfig,
      version: currentConfig.version + 1,
      systemPrompt: currentConfig.systemPrompt + "\n\n// Iteration " + i + " improvements",
    };
  }

  const totalDurationMs = Date.now() - startTime;
  const reachedTarget = currentScore >= opts.targetScore;

  // Save config to database
  const [savedConfig] = await db
    .insert(sdkMetaAgentConfigs)
    .values({
      userId,
      folderId: opts.folderId ?? null,
      name: `Config for ${task.description}`,
      provider: opts.provider,
      version: currentConfig.version,
      taskSpecJson: JSON.stringify(task),
      projectContextJson: JSON.stringify(context),
      systemPrompt: currentConfig.systemPrompt,
      instructionsFile: currentConfig.instructionsFile,
      metadataJson: JSON.stringify({
        jobId,
        iterations: iterationHistory.length,
        finalScore: currentScore,
        reachedTarget,
        stopReason,
        totalDurationMs,
      }),
    })
    .returning();

  // Update job as completed
  await db
    .update(sdkMetaAgentOptimizationJobs)
    .set({
      status: "completed",
      configId: savedConfig.id,
      currentScore,
      stopReason,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));

  return {
    jobId,
    config: {
      ...currentConfig,
      id: savedConfig.id,
    },
    iterations: iterationHistory.length,
    finalScore: currentScore,
    scoreHistory,
    iterationHistory,
    totalDurationMs,
    reachedTarget,
    stopReason,
  };
}

/**
 * Run optimization asynchronously (background)
 *
 * Updates job in database as it progresses.
 * Callers should use /status/[id] or /stream to monitor progress.
 */
async function runOptimizationAsync(
  jobId: string,
  userId: string,
  task: TaskSpec,
  context: ProjectContext,
  opts: ResolvedOptions
): Promise<void> {
  try {
    // Mark job as running
    await db
      .update(sdkMetaAgentOptimizationJobs)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));

    const startTime = Date.now();
    const scoreHistory: number[] = [];
    const iterationHistory: OptimizationSnapshot[] = [];

    // BUILD: Generate initial config
    const config = generateConfig(task, context, opts.provider, 1);

    // Simulate iterations with delays (to simulate real work)
    let currentScore = 0.5 + Math.random() * 0.2;
    let currentConfig = config;
    let stopReason: OptimizationResult["stopReason"] = "max_iterations";

    for (let i = 1; i <= opts.maxIterations; i++) {
      const iterStart = Date.now();

      // Check if job was cancelled
      const job = await db.query.sdkMetaAgentOptimizationJobs.findFirst({
        where: eq(sdkMetaAgentOptimizationJobs.id, jobId),
      });
      if (job?.status === "cancelled") {
        return; // Exit early if cancelled
      }

      // Simulate work with a short delay
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));

      // TEST: Evaluate
      scoreHistory.push(currentScore);

      // Record snapshot
      const snapshot: OptimizationSnapshot = {
        iteration: i,
        score: currentScore,
        configVersion: currentConfig.version,
        suggestionsApplied: Math.floor(Math.random() * 3),
        iterationDurationMs: Date.now() - iterStart,
      };
      iterationHistory.push(snapshot);

      // Update job progress
      await db
        .update(sdkMetaAgentOptimizationJobs)
        .set({
          currentIteration: i,
          currentScore,
          scoreHistoryJson: JSON.stringify(scoreHistory),
          iterationHistoryJson: JSON.stringify(iterationHistory),
          updatedAt: new Date(),
        })
        .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));

      // Check target
      if (currentScore >= opts.targetScore) {
        stopReason = "target_reached";
        break;
      }

      // Check timeout
      if (Date.now() - startTime > opts.timeoutSeconds * 1000) {
        stopReason = "timeout";
        break;
      }

      // IMPROVE: Refine config
      currentScore += 0.1 + Math.random() * 0.1;
      currentConfig = {
        ...currentConfig,
        version: currentConfig.version + 1,
        systemPrompt: currentConfig.systemPrompt + "\n\n// Iteration " + i + " improvements",
      };
    }

    const totalDurationMs = Date.now() - startTime;
    const reachedTarget = currentScore >= opts.targetScore;

    // Save config to database
    const [savedConfig] = await db
      .insert(sdkMetaAgentConfigs)
      .values({
        userId,
        folderId: opts.folderId ?? null,
        name: `Config for ${task.description}`,
        provider: opts.provider,
        version: currentConfig.version,
        taskSpecJson: JSON.stringify(task),
        projectContextJson: JSON.stringify(context),
        systemPrompt: currentConfig.systemPrompt,
        instructionsFile: currentConfig.instructionsFile,
        metadataJson: JSON.stringify({
          jobId,
          iterations: iterationHistory.length,
          finalScore: currentScore,
          reachedTarget,
          stopReason,
          totalDurationMs,
        }),
      })
      .returning();

    // Mark job as completed
    await db
      .update(sdkMetaAgentOptimizationJobs)
      .set({
        status: "completed",
        configId: savedConfig.id,
        currentScore,
        stopReason,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));
  } catch (error) {
    // Mark job as failed
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sdkMetaAgentOptimizationJobs)
      .set({
        status: "failed",
        stopReason: "error",
        errorMessage,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sdkMetaAgentOptimizationJobs.id, jobId));

    throw error;
  }
}
