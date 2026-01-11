/**
 * SDK Meta-Agent Types - Build-Test-Improve Loop System
 *
 * Defines the meta-agent architecture for automated configuration optimization.
 * The meta-agent operates in a BUILD → TEST → IMPROVE loop, continuously
 * refining agent configurations based on benchmarking results.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Task and Context Types
// ─────────────────────────────────────────────────────────────────────────────

/** Task specification for meta-agent optimization */
export interface TaskSpec {
  /** Unique task identifier */
  id: string;
  /** Task type */
  type: "feature" | "bugfix" | "refactor" | "test" | "docs" | "review";
  /** Human-readable description */
  description: string;
  /** Acceptance criteria */
  acceptanceCriteria?: string[];
  /** Estimated complexity (1-10) */
  complexity?: number;
  /** Related files or patterns */
  relevantFiles?: string[];
  /** Constraints or requirements */
  constraints?: string[];
  /** Associated beads issue ID */
  beadsIssueId?: string;
}

/** Project context for configuration generation */
export interface ProjectContext {
  /** Absolute path to project root */
  projectPath: string;
  /** Detected project type (nextjs, fastapi, etc.) */
  projectType: string;
  /** Primary programming language */
  language: string;
  /** Detected frameworks */
  frameworks: string[];
  /** Package manager (bun, npm, uv, cargo) */
  packageManager: string;
  /** Test framework (vitest, pytest, etc.) */
  testFramework?: string;
  /** Linter (eslint, ruff, etc.) */
  linter?: string;
  /** Whether project has CI/CD */
  hasCI: boolean;
  /** Current git branch */
  currentBranch?: string;
  /** Folder ID if in a Remote Dev folder */
  folderId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

/** Agent provider type */
export type AgentProviderType = "claude" | "codex" | "gemini" | "opencode";

/** Generated agent configuration */
export interface AgentConfig {
  /** Unique configuration ID */
  id: string;
  /** Configuration name for reference */
  name: string;
  /** Target agent provider */
  provider: AgentProviderType;
  /** Task this was generated for */
  taskSpec: TaskSpec;
  /** Project context used */
  projectContext: ProjectContext;
  /** System prompt/instructions */
  systemPrompt: string;
  /** CLAUDE.md or equivalent content */
  instructionsFile: string;
  /** MCP server configuration */
  mcpConfig?: MCPConfig;
  /** Tool restrictions */
  toolConfig?: ToolConfig;
  /** Memory configuration */
  memoryConfig?: MemoryConfig;
  /** Generation metadata */
  metadata: ConfigMetadata;
  /** Version for tracking iterations */
  version: number;
  /** When this config was created */
  createdAt: Date;
}

export interface MCPConfig {
  /** Enabled MCP servers */
  servers: string[];
  /** Tool allowlist (empty = all allowed) */
  allowedTools?: string[];
  /** Tool blocklist */
  blockedTools?: string[];
}

export interface ToolConfig {
  /** Enable file editing */
  fileEditing: boolean;
  /** Enable command execution */
  commandExecution: boolean;
  /** Enable web browsing */
  webBrowsing: boolean;
  /** Maximum concurrent tool calls */
  maxConcurrent: number;
  /** Command timeout in seconds */
  commandTimeout: number;
  /** Dangerous command patterns to block */
  blockedPatterns: string[];
}

export interface MemoryConfig {
  /** Enable hierarchical memory */
  enabled: boolean;
  /** Short-term memory TTL in seconds */
  shortTermTtl: number;
  /** Maximum working memory entries */
  maxWorkingEntries: number;
  /** Auto-consolidation interval in seconds */
  consolidationInterval: number;
}

export interface ConfigMetadata {
  /** Generation method (template, learned, hybrid) */
  generationMethod: "template" | "learned" | "hybrid";
  /** Source template ID if template-based */
  templateId?: string;
  /** Source learnings if learned */
  learningIds?: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Rationale for configuration choices */
  rationale: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark and Testing Types
// ─────────────────────────────────────────────────────────────────────────────

/** Benchmark definition for testing configurations */
export interface Benchmark {
  /** Unique benchmark ID */
  id: string;
  /** Benchmark name */
  name: string;
  /** Task spec being benchmarked */
  taskSpec: TaskSpec;
  /** Test cases to run */
  testCases: TestCase[];
  /** Success criteria */
  successCriteria: SuccessCriteria;
  /** Maximum execution time in seconds */
  timeoutSeconds: number;
}

export interface TestCase {
  /** Test case ID */
  id: string;
  /** Test description */
  description: string;
  /** Input to provide */
  input: string;
  /** Expected output patterns (regex) */
  expectedPatterns?: string[];
  /** Files that should be modified */
  expectedFileChanges?: string[];
  /** Commands that should be run */
  expectedCommands?: string[];
  /** Weight in overall score (default: 1) */
  weight?: number;
}

export interface SuccessCriteria {
  /** Minimum overall score (0-1) */
  minScore: number;
  /** All tests must pass (vs weighted average) */
  requireAllPass: boolean;
  /** Maximum execution time in seconds */
  maxDurationSeconds?: number;
  /** Must not produce errors */
  noErrors: boolean;
  /** Must pass lint/type checks */
  passLintChecks: boolean;
  /** Must pass tests */
  passTests: boolean;
}

/** Result from running a benchmark */
export interface BenchmarkResult {
  /** Benchmark ID */
  benchmarkId: string;
  /** Config that was tested */
  configId: string;
  /** Overall score (0-1) */
  score: number;
  /** Whether success criteria were met */
  passed: boolean;
  /** Individual test case results */
  testResults: TestCaseResult[];
  /** Execution duration in ms */
  durationMs: number;
  /** Errors encountered */
  errors: string[];
  /** Warnings generated */
  warnings: string[];
  /** Raw output from agent */
  rawOutput?: string;
  /** Files modified */
  filesModified: string[];
  /** Commands executed */
  commandsExecuted: string[];
  /** When benchmark was run */
  executedAt: Date;
}

export interface TestCaseResult {
  /** Test case ID */
  testCaseId: string;
  /** Whether test passed */
  passed: boolean;
  /** Score for this test (0-1) */
  score: number;
  /** Expected vs actual comparison */
  comparison?: {
    expected: string;
    actual: string;
    match: boolean;
  };
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Improvement and Refinement Types
// ─────────────────────────────────────────────────────────────────────────────

/** Refinement suggestions from analyzing benchmark results */
export interface RefinementSuggestion {
  /** Unique suggestion ID */
  id: string;
  /** What to change */
  target: "system_prompt" | "instructions" | "mcp_config" | "tool_config" | "memory_config";
  /** Type of change */
  changeType: "add" | "remove" | "modify";
  /** Current value (if modifying) */
  currentValue?: string;
  /** Suggested new value */
  suggestedValue: string;
  /** Rationale for the suggestion */
  rationale: string;
  /** Expected impact on score */
  expectedImpact: number;
  /** Confidence in this suggestion (0-1) */
  confidence: number;
  /** Source: benchmark result analysis or learned pattern */
  source: "benchmark_analysis" | "learned_pattern" | "manual";
}

/** Result from improvement phase */
export interface ImprovementResult {
  /** Original config */
  originalConfig: AgentConfig;
  /** Improved config */
  improvedConfig: AgentConfig;
  /** Suggestions that were applied */
  appliedSuggestions: RefinementSuggestion[];
  /** Suggestions that were rejected (with reasons) */
  rejectedSuggestions: Array<{
    suggestion: RefinementSuggestion;
    reason: string;
  }>;
  /** Expected score improvement */
  expectedImprovement: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization Loop Types
// ─────────────────────────────────────────────────────────────────────────────

/** Result from full optimization loop */
export interface OptimizationResult {
  /** Final optimized configuration */
  config: AgentConfig;
  /** Number of iterations performed */
  iterations: number;
  /** Final benchmark score */
  finalScore: number;
  /** Score history across iterations */
  scoreHistory: number[];
  /** Total duration in ms */
  totalDurationMs: number;
  /** Whether optimization reached target score */
  reachedTarget: boolean;
  /** Reason for stopping */
  stopReason: "target_reached" | "max_iterations" | "no_improvement" | "timeout" | "error";
}

/** Options for optimization loop */
export interface OptimizationOptions {
  /** Maximum iterations (default: 3) */
  maxIterations?: number;
  /** Target score to reach (default: 0.9) */
  targetScore?: number;
  /** Minimum improvement per iteration to continue (default: 0.05) */
  minImprovement?: number;
  /** Maximum total time in seconds */
  timeoutSeconds?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Dry run - don't actually run agents */
  dryRun?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta-Agent Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for the meta-agent implementation.
 * Orchestrates the BUILD → TEST → IMPROVE loop.
 */
export interface IMetaAgent {
  /**
   * BUILD phase: Generate an agent configuration for a task.
   */
  build(task: TaskSpec, context: ProjectContext): Promise<AgentConfig>;

  /**
   * TEST phase: Evaluate a configuration against a benchmark.
   */
  test(config: AgentConfig, benchmark: Benchmark): Promise<BenchmarkResult>;

  /**
   * IMPROVE phase: Refine configuration based on test results.
   */
  improve(config: AgentConfig, results: BenchmarkResult): Promise<AgentConfig>;

  /**
   * Full optimization loop: BUILD → TEST → IMPROVE until target or max iterations.
   */
  optimize(
    task: TaskSpec,
    context: ProjectContext,
    options?: OptimizationOptions
  ): Promise<OptimizationResult>;

  /**
   * Create a benchmark for a task.
   */
  createBenchmark(task: TaskSpec, context: ProjectContext): Promise<Benchmark>;

  /**
   * Get refinement suggestions from benchmark results.
   */
  getSuggestions(
    config: AgentConfig,
    results: BenchmarkResult
  ): Promise<RefinementSuggestion[]>;

  /**
   * Apply a specific suggestion to a configuration.
   */
  applySuggestion(
    config: AgentConfig,
    suggestion: RefinementSuggestion
  ): Promise<AgentConfig>;

  /**
   * Learn from a successful configuration (store patterns for future use).
   */
  learnFromSuccess(config: AgentConfig, results: BenchmarkResult): Promise<void>;

  /**
   * Get configuration templates for a project type.
   */
  getTemplates(projectType: string): Promise<AgentConfig[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Template Types
// ─────────────────────────────────────────────────────────────────────────────

/** Template for generating configurations */
export interface ConfigTemplate {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Project types this template applies to */
  projectTypes: string[];
  /** Task types this template is good for */
  taskTypes: string[];
  /** Base system prompt */
  baseSystemPrompt: string;
  /** Base instructions file content */
  baseInstructions: string;
  /** Default MCP configuration */
  defaultMcpConfig: MCPConfig;
  /** Default tool configuration */
  defaultToolConfig: ToolConfig;
  /** Default memory configuration */
  defaultMemoryConfig: MemoryConfig;
  /** Variables that can be substituted */
  variables: TemplateVariable[];
  /** Average benchmark score from uses */
  avgScore: number;
  /** Number of times used */
  useCount: number;
}

export interface TemplateVariable {
  /** Variable name (e.g., "{{PROJECT_NAME}}") */
  name: string;
  /** Description */
  description: string;
  /** Default value */
  defaultValue: string;
  /** How to resolve this variable */
  resolver: "project_context" | "task_spec" | "user_input" | "computed";
}
