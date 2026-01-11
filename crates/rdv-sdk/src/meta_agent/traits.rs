//! Meta-Agent Trait Interface
//!
//! Defines the trait for meta-agent implementations, enabling different
//! optimization strategies (rule-based, LLM-based, mock for testing).

use async_trait::async_trait;

use crate::SDKResult;
use super::types::{
    AgentConfig, Benchmark, BenchmarkResult, OptimizationOptions, OptimizationResult,
    ProjectContext, RefinementSuggestion, TaskSpec,
};

/// Trait for meta-agent implementations.
///
/// The meta-agent follows a BUILD → TEST → IMPROVE loop to optimize
/// agent configurations for specific tasks. Different implementations
/// can use different strategies for each phase.
///
/// # Note on Thread Safety
///
/// This trait uses `?Send` because the default implementation uses
/// rusqlite which is not thread-safe. Implementations that need
/// thread-safety should wrap appropriately.
///
/// # Example
///
/// ```rust,ignore
/// use rdv_sdk::meta_agent::{MetaAgentTrait, TaskSpec, ProjectContext};
///
/// async fn optimize_config(agent: &impl MetaAgentTrait, task: TaskSpec, ctx: ProjectContext) {
///     // BUILD: Generate initial configuration
///     let config = agent.build(&task, &ctx).await.unwrap();
///
///     // Create benchmark
///     let benchmark = agent.create_benchmark(&task, &ctx).await.unwrap();
///
///     // TEST: Evaluate configuration
///     let results = agent.test(&config, &benchmark).await.unwrap();
///
///     // IMPROVE: Refine based on results
///     let improved = agent.improve(&config, &results).await.unwrap();
/// }
/// ```
#[async_trait(?Send)]
pub trait MetaAgentTrait {
    /// BUILD phase: Generate an agent configuration for a task.
    ///
    /// Takes a task specification and project context, and generates
    /// an optimized agent configuration including system prompt and
    /// instructions file content.
    ///
    /// # Arguments
    ///
    /// * `task` - The task specification to optimize for
    /// * `context` - Project context (language, frameworks, etc.)
    ///
    /// # Returns
    ///
    /// Generated agent configuration
    async fn build(&self, task: &TaskSpec, context: &ProjectContext) -> SDKResult<AgentConfig>;

    /// TEST phase: Evaluate a configuration against a benchmark.
    ///
    /// Runs test cases against the configuration and produces a
    /// scored result indicating how well the config performs.
    ///
    /// # Arguments
    ///
    /// * `config` - The agent configuration to test
    /// * `benchmark` - The benchmark with test cases
    ///
    /// # Returns
    ///
    /// Benchmark results with scores and test case outcomes
    async fn test(&self, config: &AgentConfig, benchmark: &Benchmark) -> SDKResult<BenchmarkResult>;

    /// IMPROVE phase: Refine configuration based on test results.
    ///
    /// Analyzes test results to identify weaknesses and generates
    /// an improved configuration with refinements applied.
    ///
    /// # Arguments
    ///
    /// * `config` - The current configuration to improve
    /// * `results` - Benchmark results from testing
    ///
    /// # Returns
    ///
    /// Improved configuration with version incremented
    async fn improve(&self, config: &AgentConfig, results: &BenchmarkResult) -> SDKResult<AgentConfig>;

    /// Create a benchmark for a task.
    ///
    /// Generates test cases based on the task type and acceptance criteria.
    ///
    /// # Arguments
    ///
    /// * `task` - The task to create a benchmark for
    /// * `context` - Project context for framework-specific tests
    ///
    /// # Returns
    ///
    /// Benchmark with test cases
    async fn create_benchmark(&self, task: &TaskSpec, context: &ProjectContext) -> SDKResult<Benchmark>;

    /// Get refinement suggestions based on test results.
    ///
    /// Analyzes failed tests and produces suggestions for improving
    /// the configuration.
    ///
    /// # Arguments
    ///
    /// * `config` - The current configuration
    /// * `results` - Benchmark results to analyze
    ///
    /// # Returns
    ///
    /// List of refinement suggestions with confidence scores
    async fn get_suggestions(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>>;

    /// Full optimization loop.
    ///
    /// Iteratively runs BUILD → TEST → IMPROVE until the target score
    /// is reached, max iterations exceeded, or no improvement is made.
    ///
    /// # Arguments
    ///
    /// * `task` - The task to optimize for
    /// * `context` - Project context
    /// * `options` - Optional optimization parameters (max iterations, target score, etc.)
    ///
    /// # Returns
    ///
    /// Optimization result with final config and score history
    async fn optimize(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
        options: Option<OptimizationOptions>,
    ) -> SDKResult<OptimizationResult>;
}

/// Trait for provider-specific configuration generation.
///
/// Different agent providers (Claude, Codex, Gemini, OpenCode) have
/// different configuration formats and optimal prompting strategies.
#[async_trait(?Send)]
pub trait ProviderConfigGenerator {
    /// Generate provider-specific system prompt.
    async fn generate_system_prompt(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String>;

    /// Generate provider-specific instructions file content.
    async fn generate_instructions(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String>;

    /// Get the configuration file name for this provider.
    fn config_filename(&self) -> &'static str;
}

/// Trait for benchmark execution.
///
/// Allows different benchmark execution strategies (mock, sandbox, real).
#[async_trait(?Send)]
pub trait BenchmarkExecutor {
    /// Execute a single test case against a configuration.
    async fn execute_test_case(
        &self,
        config: &AgentConfig,
        test_case: &super::types::TestCase,
    ) -> SDKResult<super::types::TestCaseResult>;

    /// Check if execution should be sandboxed.
    fn is_sandboxed(&self) -> bool;

    /// Get timeout for test execution in seconds.
    fn timeout_seconds(&self) -> u64;
}

/// Trait for refinement strategy.
///
/// Different strategies for analyzing results and generating improvements.
#[async_trait(?Send)]
pub trait RefinementStrategy {
    /// Analyze benchmark results and suggest refinements.
    async fn analyze(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>>;

    /// Apply a suggestion to a configuration.
    async fn apply_suggestion(
        &self,
        config: &AgentConfig,
        suggestion: &RefinementSuggestion,
    ) -> SDKResult<AgentConfig>;

    /// Get minimum confidence threshold for applying suggestions.
    fn min_confidence(&self) -> f64 {
        0.5
    }
}
