//! Meta-Agent Type Definitions

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Task specification for meta-agent optimization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSpec {
    pub id: String,
    pub task_type: TaskType,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub complexity: Option<u8>,
    pub relevant_files: Vec<String>,
    pub constraints: Vec<String>,
    pub beads_issue_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Feature,
    Bugfix,
    Refactor,
    Test,
    Docs,
    Review,
}

/// Project context for configuration generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContext {
    pub project_path: String,
    pub project_type: String,
    pub language: String,
    pub frameworks: Vec<String>,
    pub package_manager: String,
    pub test_framework: Option<String>,
    pub linter: Option<String>,
    pub has_ci: bool,
    pub current_branch: Option<String>,
    pub folder_id: Option<String>,
}

/// Generated agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub provider: AgentProvider,
    pub task_spec: TaskSpec,
    pub project_context: ProjectContext,
    pub system_prompt: String,
    pub instructions_file: String,
    pub version: u32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    Claude,
    Codex,
    Gemini,
    Opencode,
}

/// Benchmark definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Benchmark {
    pub id: String,
    pub name: String,
    pub task_spec: TaskSpec,
    pub test_cases: Vec<TestCase>,
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCase {
    pub id: String,
    pub description: String,
    pub input: String,
    pub expected_patterns: Vec<String>,
    pub expected_file_changes: Vec<String>,
    pub expected_commands: Vec<String>,
    pub weight: f64,
}

/// Benchmark execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub benchmark_id: String,
    pub config_id: String,
    pub score: f64,
    pub passed: bool,
    pub test_results: Vec<TestCaseResult>,
    pub duration_ms: u64,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub files_modified: Vec<String>,
    pub commands_executed: Vec<String>,
    pub executed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCaseResult {
    pub test_case_id: String,
    pub passed: bool,
    pub score: f64,
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// Optimization result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationResult {
    pub config: AgentConfig,
    pub iterations: usize,
    pub final_score: f64,
    pub score_history: Vec<f64>,
    pub total_duration_ms: u64,
    pub reached_target: bool,
    pub stop_reason: StopReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    TargetReached,
    MaxIterations,
    NoImprovement,
    Timeout,
    Error,
}

/// Optimization options
#[derive(Debug, Clone)]
pub struct OptimizationOptions {
    pub max_iterations: usize,
    pub target_score: f64,
    pub min_improvement: f64,
    pub timeout_seconds: u64,
    pub verbose: bool,
    pub dry_run: bool,
}

impl Default for OptimizationOptions {
    fn default() -> Self {
        Self {
            max_iterations: 3,
            target_score: 0.9,
            min_improvement: 0.05,
            timeout_seconds: 600,
            verbose: false,
            dry_run: false,
        }
    }
}

/// Refinement suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefinementSuggestion {
    pub id: String,
    pub target: RefinementTarget,
    pub change_type: ChangeType,
    pub current_value: Option<String>,
    pub suggested_value: String,
    pub rationale: String,
    pub expected_impact: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefinementTarget {
    SystemPrompt,
    Instructions,
    McpConfig,
    ToolConfig,
    MemoryConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Add,
    Remove,
    Modify,
}

/// Improvement result
#[derive(Debug, Clone)]
pub struct ImprovementResult {
    pub original_config: AgentConfig,
    pub improved_config: AgentConfig,
    pub applied_suggestions: Vec<RefinementSuggestion>,
    pub rejected_suggestions: Vec<(RefinementSuggestion, String)>,
    pub expected_improvement: f64,
}
