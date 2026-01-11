"use client";

/**
 * useMetaAgent - Hook for meta-agent operations.
 *
 * Provides access to:
 * - Build agent configurations from task specs
 * - Test configurations against benchmarks
 * - Improve configurations based on results
 * - Optimize configurations iteratively
 * - Get refinement suggestions
 */

import { useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirroring SDK types for client-side use)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskSpec {
  id: string;
  description: string;
  complexity: number;
  type: "feature" | "bugfix" | "refactor" | "test" | "docs" | "research";
  tags?: string[];
  constraints?: string[];
}

export interface ProjectContext {
  projectPath: string;
  projectType: string;
  language: string;
  frameworks: string[];
  packageManager: string;
  hasCI: boolean;
  customInstructions?: string[];
}

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools: string[];
  memory: {
    enabled: boolean;
    maxContext: number;
  };
  safety: {
    confirmDestructive: boolean;
    dryRunMode: boolean;
  };
}

export interface Benchmark {
  id: string;
  name: string;
  description: string;
  testCases: BenchmarkTestCase[];
  passingScore: number;
}

export interface BenchmarkTestCase {
  id: string;
  input: string;
  expectedBehavior: string;
  weight: number;
}

export interface BenchmarkResult {
  benchmarkId: string;
  configId: string;
  score: number;
  passedTests: number;
  totalTests: number;
  testResults: TestCaseResult[];
  executionTimeMs: number;
  timestamp: Date;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  score: number;
  actualBehavior: string;
  feedback?: string;
}

export interface OptimizationResult {
  initialConfig: AgentConfig;
  finalConfig: AgentConfig;
  iterations: OptimizationIteration[];
  improvement: number;
  finalScore: number;
}

export interface OptimizationIteration {
  iteration: number;
  config: AgentConfig;
  score: number;
  changes: string[];
}

export interface RefinementSuggestion {
  id: string;
  type: "prompt" | "tools" | "memory" | "temperature" | "model";
  description: string;
  rationale: string;
  expectedImprovement: number;
  priority: "high" | "medium" | "low";
}

export interface OptimizationOptions {
  maxIterations?: number;
  targetScore?: number;
  focusAreas?: ("prompt" | "tools" | "memory" | "temperature")[];
}

export interface UseMetaAgentReturn {
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Build an agent config from task and context */
  build: (task: TaskSpec, context: ProjectContext) => Promise<AgentConfig | null>;
  /** Test a config against a benchmark */
  test: (config: AgentConfig, benchmark: Benchmark) => Promise<BenchmarkResult | null>;
  /** Improve a config based on test results */
  improve: (config: AgentConfig, results: BenchmarkResult) => Promise<AgentConfig | null>;
  /** Optimize a config iteratively */
  optimize: (
    task: TaskSpec,
    context: ProjectContext,
    options?: OptimizationOptions
  ) => Promise<OptimizationResult | null>;
  /** Get refinement suggestions */
  getSuggestions: (
    config: AgentConfig,
    results: BenchmarkResult
  ) => Promise<RefinementSuggestion[]>;
  /** Apply a suggestion to a config */
  applySuggestion: (
    config: AgentConfig,
    suggestion: RefinementSuggestion
  ) => Promise<AgentConfig | null>;
  /** Get available templates for a project type */
  getTemplates: (projectType: string) => Promise<AgentConfig[]>;
  /** Create a benchmark from task spec */
  createBenchmark: (task: TaskSpec, context: ProjectContext) => Promise<Benchmark | null>;
  /** Clear error state */
  clearError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useMetaAgent(): UseMetaAgentReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Build an agent configuration from task and project context
   */
  const build = useCallback(
    async (task: TaskSpec, context: ProjectContext): Promise<AgentConfig | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, context }),
        });

        if (!response.ok) {
          throw new Error(`Build failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Build error:", err);
        setError(err instanceof Error ? err.message : "Failed to build config");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Test a configuration against a benchmark
   */
  const test = useCallback(
    async (config: AgentConfig, benchmark: Benchmark): Promise<BenchmarkResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, benchmark }),
        });

        if (!response.ok) {
          throw new Error(`Test failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Test error:", err);
        setError(err instanceof Error ? err.message : "Failed to test config");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Improve a configuration based on test results
   */
  const improve = useCallback(
    async (config: AgentConfig, results: BenchmarkResult): Promise<AgentConfig | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/improve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, results }),
        });

        if (!response.ok) {
          throw new Error(`Improve failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Improve error:", err);
        setError(err instanceof Error ? err.message : "Failed to improve config");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Optimize a configuration iteratively
   */
  const optimize = useCallback(
    async (
      task: TaskSpec,
      context: ProjectContext,
      options?: OptimizationOptions
    ): Promise<OptimizationResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, context, options }),
        });

        if (!response.ok) {
          throw new Error(`Optimize failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Optimize error:", err);
        setError(err instanceof Error ? err.message : "Failed to optimize config");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Get refinement suggestions for a configuration
   */
  const getSuggestions = useCallback(
    async (
      config: AgentConfig,
      results: BenchmarkResult
    ): Promise<RefinementSuggestion[]> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, results }),
        });

        if (!response.ok) {
          throw new Error(`Get suggestions failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Get suggestions error:", err);
        setError(err instanceof Error ? err.message : "Failed to get suggestions");
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Apply a suggestion to a configuration
   */
  const applySuggestion = useCallback(
    async (
      config: AgentConfig,
      suggestion: RefinementSuggestion
    ): Promise<AgentConfig | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/apply-suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, suggestion }),
        });

        if (!response.ok) {
          throw new Error(`Apply suggestion failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Apply suggestion error:", err);
        setError(err instanceof Error ? err.message : "Failed to apply suggestion");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Get available templates for a project type
   */
  const getTemplates = useCallback(async (projectType: string): Promise<AgentConfig[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/sdk/meta-agent/templates?projectType=${encodeURIComponent(projectType)}`
      );

      if (!response.ok) {
        throw new Error(`Get templates failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      console.error("[useMetaAgent] Get templates error:", err);
      setError(err instanceof Error ? err.message : "Failed to get templates");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Create a benchmark from task spec
   */
  const createBenchmark = useCallback(
    async (task: TaskSpec, context: ProjectContext): Promise<Benchmark | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sdk/meta-agent/create-benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, context }),
        });

        if (!response.ok) {
          throw new Error(`Create benchmark failed: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        console.error("[useMetaAgent] Create benchmark error:", err);
        setError(err instanceof Error ? err.message : "Failed to create benchmark");
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    build,
    test,
    improve,
    optimize,
    getSuggestions,
    applySuggestion,
    getTemplates,
    createBenchmark,
    clearError,
  };
}
