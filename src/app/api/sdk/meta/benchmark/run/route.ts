/**
 * SDK Meta-Agent Benchmark Run API Route
 *
 * Executes a benchmark against a configuration.
 */

import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api";
import type { AgentConfig } from "../../route";
import type { Benchmark, BenchmarkResult, TestCaseResult } from "../route";

// Shared benchmark storage (in production, use database or import from benchmark/route.ts)
const benchmarks = new Map<string, Benchmark>();
const benchmarkResults = new Map<string, BenchmarkResult>();

/**
 * POST /api/sdk/meta/benchmark/run - Run a benchmark against a config
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { benchmarkId, config, benchmark: inlineBenchmark } = body as {
      benchmarkId?: string;
      config: AgentConfig;
      benchmark?: Benchmark;
    };

    // Validate required fields
    if (!config) {
      return NextResponse.json(
        { error: "config is required" },
        { status: 400 }
      );
    }

    // Get or use inline benchmark
    let benchmark: Benchmark | undefined;
    if (benchmarkId) {
      benchmark = benchmarks.get(benchmarkId);
      if (!benchmark) {
        return NextResponse.json(
          { error: "Benchmark not found" },
          { status: 404 }
        );
      }
    } else if (inlineBenchmark) {
      benchmark = inlineBenchmark;
    } else {
      return NextResponse.json(
        { error: "benchmarkId or inline benchmark required" },
        { status: 400 }
      );
    }

    // Execute benchmark
    const startTime = Date.now();
    const testResults: TestCaseResult[] = [];
    let totalScore = 0;
    let totalWeight = 0;

    for (const testCase of benchmark.testCases) {
      const testStart = Date.now();

      // Simulate test execution with pattern matching
      const { score, passed, error } = evaluateTestCase(config, testCase);

      testResults.push({
        testCaseId: testCase.id,
        passed,
        score,
        error,
        durationMs: Date.now() - testStart,
      });

      totalScore += score * testCase.weight;
      totalWeight += testCase.weight;
    }

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const allPassed = testResults.every(r => r.passed);

    const result: BenchmarkResult = {
      benchmarkId: benchmark.id,
      configId: config.id,
      score: finalScore,
      passed: allPassed && finalScore >= 0.7,
      testResults,
      durationMs: Date.now() - startTime,
      errors: testResults.filter(r => r.error).map(r => r.error!),
      warnings: [],
      filesModified: [],
      commandsExecuted: [],
      executedAt: new Date().toISOString(),
    };

    // Store result
    const resultId = `result-${userId}-${Date.now()}`;
    benchmarkResults.set(resultId, result);

    return NextResponse.json({
      resultId,
      ...result,
    });
  } catch (error) {
    console.error("Failed to run benchmark:", error);
    return NextResponse.json(
      { error: "Failed to run benchmark" },
      { status: 500 }
    );
  }
});

// Helper: Evaluate a test case against a config
function evaluateTestCase(
  config: AgentConfig,
  testCase: { expectedPatterns: string[]; description: string; id: string }
): { score: number; passed: boolean; error?: string } {
  const { expectedPatterns } = testCase;

  if (expectedPatterns.length === 0) {
    // No patterns to check, assume pass
    return { score: 1.0, passed: true };
  }

  // Check patterns in system prompt and instructions
  const combinedContent = (config.systemPrompt + " " + config.instructionsFile).toLowerCase();
  let matchedPatterns = 0;

  for (const pattern of expectedPatterns) {
    if (combinedContent.includes(pattern.toLowerCase())) {
      matchedPatterns++;
    }
  }

  const score = matchedPatterns / expectedPatterns.length;
  const passed = matchedPatterns === expectedPatterns.length;

  return {
    score,
    passed,
    error: passed ? undefined : `Only ${matchedPatterns}/${expectedPatterns.length} patterns matched`,
  };
}
