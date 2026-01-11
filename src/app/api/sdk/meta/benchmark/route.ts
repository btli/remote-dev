/**
 * SDK Meta-Agent Benchmark API Routes
 *
 * Provides endpoints for creating and running benchmarks.
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import type { TaskSpec, ProjectContext, AgentConfig } from "../route";

// Benchmark types
export interface TestCase {
  id: string;
  description: string;
  input: string;
  expectedPatterns: string[];
  expectedFileChanges: string[];
  expectedCommands: string[];
  weight: number;
}

export interface Benchmark {
  id: string;
  name: string;
  taskSpec: TaskSpec;
  testCases: TestCase[];
  timeoutSeconds: number;
  createdAt: string;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  score: number;
  error?: string;
  durationMs: number;
}

export interface BenchmarkResult {
  benchmarkId: string;
  configId: string;
  score: number;
  passed: boolean;
  testResults: TestCaseResult[];
  durationMs: number;
  errors: string[];
  warnings: string[];
  filesModified: string[];
  commandsExecuted: string[];
  executedAt: string;
}

// In-memory storage (in production, use database)
const benchmarks = new Map<string, Benchmark>();
const benchmarkResults = new Map<string, BenchmarkResult>();

/**
 * POST /api/sdk/meta/benchmark - Create a benchmark
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { task, context, testCases, timeoutSeconds } = body as {
      task: TaskSpec;
      context?: ProjectContext;
      testCases?: TestCase[];
      timeoutSeconds?: number;
    };

    // Validate required fields
    if (!task) {
      return NextResponse.json(
        { error: "task is required" },
        { status: 400 }
      );
    }

    // Generate benchmark
    const benchmarkId = `bench-${userId}-${Date.now()}`;
    const generatedTestCases = testCases ?? generateTestCasesForTask(task);

    const benchmark: Benchmark = {
      id: benchmarkId,
      name: `Benchmark for: ${task.description}`,
      taskSpec: task,
      testCases: generatedTestCases,
      timeoutSeconds: timeoutSeconds ?? 300,
      createdAt: new Date().toISOString(),
    };

    benchmarks.set(benchmarkId, benchmark);

    return NextResponse.json(benchmark, { status: 201 });
  } catch (error) {
    console.error("Failed to create benchmark:", error);
    return NextResponse.json(
      { error: "Failed to create benchmark" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/meta/benchmark - List benchmarks or get specific benchmark
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const benchmarkId = url.searchParams.get("benchmarkId");

    if (benchmarkId) {
      // Get specific benchmark
      const benchmark = benchmarks.get(benchmarkId);
      if (!benchmark) {
        return NextResponse.json(
          { error: "Benchmark not found" },
          { status: 404 }
        );
      }

      // Get results for this benchmark
      const results: BenchmarkResult[] = [];
      for (const [, result] of Array.from(benchmarkResults.entries())) {
        if (result.benchmarkId === benchmarkId) {
          results.push(result);
        }
      }

      return NextResponse.json({
        benchmark,
        results,
      });
    }

    // List all benchmarks for user
    const userBenchmarks: Benchmark[] = [];
    for (const [id, benchmark] of Array.from(benchmarks.entries())) {
      if (id.includes(`-${userId}-`)) {
        userBenchmarks.push(benchmark);
      }
    }

    return NextResponse.json({
      benchmarks: userBenchmarks.slice(0, 50),
      total: userBenchmarks.length,
    });
  } catch (error) {
    console.error("Failed to query benchmarks:", error);
    return NextResponse.json(
      { error: "Failed to query benchmarks" },
      { status: 500 }
    );
  }
});

// Helper: Generate test cases based on task type
function generateTestCasesForTask(task: TaskSpec): TestCase[] {
  const testCases: TestCase[] = [];

  switch (task.taskType) {
    case "feature":
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "Feature implementation test",
        input: task.description,
        expectedPatterns: task.acceptanceCriteria,
        expectedFileChanges: task.relevantFiles,
        expectedCommands: [],
        weight: 1.0,
      });
      break;

    case "bugfix":
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "Bug fix verification",
        input: task.description,
        expectedPatterns: ["fix"],
        expectedFileChanges: task.relevantFiles,
        expectedCommands: ["test"],
        weight: 1.0,
      });
      break;

    case "refactor":
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "Refactor compatibility test",
        input: task.description,
        expectedPatterns: ["refactor"],
        expectedFileChanges: task.relevantFiles,
        expectedCommands: ["test", "lint"],
        weight: 1.0,
      });
      break;

    case "test":
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "Test coverage check",
        input: task.description,
        expectedPatterns: ["test", "expect", "assert"],
        expectedFileChanges: task.relevantFiles.filter(f => f.includes("test") || f.includes("spec")),
        expectedCommands: ["test"],
        weight: 1.0,
      });
      break;

    case "docs":
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "Documentation completeness",
        input: task.description,
        expectedPatterns: ["documentation", "readme"],
        expectedFileChanges: task.relevantFiles.filter(f => f.endsWith(".md") || f.includes("doc")),
        expectedCommands: [],
        weight: 1.0,
      });
      break;

    default:
      testCases.push({
        id: `tc-${Date.now()}-1`,
        description: "General task test",
        input: task.description,
        expectedPatterns: [],
        expectedFileChanges: [],
        expectedCommands: [],
        weight: 1.0,
      });
  }

  return testCases;
}
