//! Meta-Agent Implementation
//!
//! Implements the BUILD → TEST → IMPROVE loop.

use std::sync::Arc;
use async_trait::async_trait;
use chrono::Utc;
use rusqlite::Connection;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{SDKResult, config::MetaAgentConfig};
use super::traits::MetaAgentTrait;
use super::generators::create_config_generator;
use super::types::*;

/// Meta-agent for configuration optimization.
///
/// Implements the core BUILD → TEST → IMPROVE loop for generating
/// and refining agent configurations based on task performance.
///
/// # Example
///
/// ```rust,ignore
/// use rdv_sdk::meta_agent::{MetaAgent, MetaAgentTrait, TaskSpec, ProjectContext};
///
/// let agent = MetaAgent::new(db, config);
///
/// // Use the trait methods
/// let config = agent.build(&task, &context).await?;
/// let benchmark = agent.create_benchmark(&task, &context).await?;
/// let results = agent.test(&config, &benchmark).await?;
/// ```
#[allow(dead_code)]
pub struct MetaAgent {
    db: Arc<RwLock<Connection>>,
    config: MetaAgentConfig,
}

impl MetaAgent {
    /// Create a new meta-agent with database connection and configuration.
    pub fn new(db: Arc<RwLock<Connection>>, config: MetaAgentConfig) -> Self {
        Self { db, config }
    }

    /// Get a reference to the database connection.
    #[allow(dead_code)]
    pub fn db(&self) -> &Arc<RwLock<Connection>> {
        &self.db
    }

    /// Get a reference to the configuration.
    #[allow(dead_code)]
    pub fn config(&self) -> &MetaAgentConfig {
        &self.config
    }

    /// Build a configuration for a specific provider.
    ///
    /// Uses provider-specific generators to create optimized system prompts
    /// and instructions files.
    pub async fn build_for_provider(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
        provider: AgentProvider,
    ) -> SDKResult<AgentConfig> {
        let id = Uuid::new_v4().to_string();
        let generator = create_config_generator(provider);

        // Use provider-specific generation
        let system_prompt = generator.generate_system_prompt(task, context).await?;
        let instructions_file = generator.generate_instructions(task, context).await?;

        Ok(AgentConfig {
            id,
            name: format!("Config for {} ({:?})", task.description, provider),
            provider,
            task_spec: task.clone(),
            project_context: context.clone(),
            system_prompt,
            instructions_file,
            version: 1,
            created_at: Utc::now(),
        })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Private Helpers (Legacy - kept for backwards compatibility)
    // ─────────────────────────────────────────────────────────────────────────────

    fn generate_system_prompt(&self, task: &TaskSpec, context: &ProjectContext) -> String {
        format!(
            "You are working on a {} project using {}.\n\
            Task: {}\n\
            Type: {:?}\n\n\
            Follow best practices for {} development.",
            context.project_type,
            context.language,
            task.description,
            task.task_type,
            context.language
        )
    }

    fn generate_instructions(&self, task: &TaskSpec, context: &ProjectContext) -> String {
        let mut instructions = format!(
            "# Project: {}\n\n\
            ## Task\n{}\n\n",
            context.project_path,
            task.description
        );

        if !task.acceptance_criteria.is_empty() {
            instructions.push_str("## Acceptance Criteria\n");
            for criterion in &task.acceptance_criteria {
                instructions.push_str(&format!("- {}\n", criterion));
            }
        }

        if !task.constraints.is_empty() {
            instructions.push_str("\n## Constraints\n");
            for constraint in &task.constraints {
                instructions.push_str(&format!("- {}\n", constraint));
            }
        }

        instructions
    }

    async fn run_test_case(
        &self,
        _config: &AgentConfig,
        test_case: &TestCase,
    ) -> SDKResult<TestCaseResult> {
        // Placeholder implementation
        // In production, this would actually run the agent with the config
        // The actual implementation is tracked in beads task remote-dev-9udg
        Ok(TestCaseResult {
            test_case_id: test_case.id.clone(),
            passed: true,
            score: 0.8,
            error: None,
            duration_ms: 100,
        })
    }

    async fn apply_suggestion(
        &self,
        config: &AgentConfig,
        suggestion: &RefinementSuggestion,
    ) -> SDKResult<AgentConfig> {
        let mut updated = config.clone();

        match suggestion.target {
            RefinementTarget::SystemPrompt => {
                updated.system_prompt = format!(
                    "{}\n\n{}",
                    config.system_prompt,
                    suggestion.suggested_value
                );
            }
            RefinementTarget::Instructions => {
                updated.instructions_file = format!(
                    "{}\n\n{}",
                    config.instructions_file,
                    suggestion.suggested_value
                );
            }
            _ => {
                // Other targets not yet implemented
                // Tracked in beads task remote-dev-738u
            }
        }

        Ok(updated)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaAgentTrait Implementation
// ─────────────────────────────────────────────────────────────────────────────

#[async_trait(?Send)]
impl MetaAgentTrait for MetaAgent {
    /// BUILD phase: Generate an agent configuration for a task.
    async fn build(&self, task: &TaskSpec, context: &ProjectContext) -> SDKResult<AgentConfig> {
        let id = Uuid::new_v4().to_string();

        // Generate system prompt based on task and context
        let system_prompt = self.generate_system_prompt(task, context);

        // Generate instructions file content
        let instructions_file = self.generate_instructions(task, context);

        Ok(AgentConfig {
            id,
            name: format!("Config for {}", task.description),
            provider: AgentProvider::Claude, // Default to Claude
            task_spec: task.clone(),
            project_context: context.clone(),
            system_prompt,
            instructions_file,
            version: 1,
            created_at: Utc::now(),
        })
    }

    /// TEST phase: Evaluate a configuration against a benchmark.
    async fn test(&self, config: &AgentConfig, benchmark: &Benchmark) -> SDKResult<BenchmarkResult> {
        let start = std::time::Instant::now();
        let mut test_results = Vec::new();
        let mut total_score = 0.0;
        let mut total_weight = 0.0;

        // Run each test case
        for test_case in &benchmark.test_cases {
            let case_result = self.run_test_case(config, test_case).await?;
            total_score += case_result.score * test_case.weight;
            total_weight += test_case.weight;
            test_results.push(case_result);
        }

        let score = if total_weight > 0.0 {
            total_score / total_weight
        } else {
            0.0
        };

        Ok(BenchmarkResult {
            benchmark_id: benchmark.id.clone(),
            config_id: config.id.clone(),
            score,
            passed: score >= 0.7, // Default passing threshold
            test_results,
            duration_ms: start.elapsed().as_millis() as u64,
            errors: Vec::new(),
            warnings: Vec::new(),
            files_modified: Vec::new(),
            commands_executed: Vec::new(),
            executed_at: Utc::now(),
        })
    }

    /// IMPROVE phase: Refine configuration based on test results.
    async fn improve(&self, config: &AgentConfig, results: &BenchmarkResult) -> SDKResult<AgentConfig> {
        let suggestions = self.get_suggestions(config, results).await?;

        let mut improved = config.clone();
        improved.id = Uuid::new_v4().to_string();
        improved.version = config.version + 1;

        // Apply suggestions that meet confidence threshold
        for suggestion in suggestions {
            if suggestion.confidence >= 0.5 {
                improved = self.apply_suggestion(&improved, &suggestion).await?;
            }
        }

        Ok(improved)
    }

    /// Create a benchmark for a task.
    async fn create_benchmark(&self, task: &TaskSpec, _context: &ProjectContext) -> SDKResult<Benchmark> {
        let id = Uuid::new_v4().to_string();

        // Generate test cases based on task type
        let test_cases = match task.task_type {
            TaskType::Feature => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Feature implementation test".into(),
                    input: task.description.clone(),
                    expected_patterns: task.acceptance_criteria.clone(),
                    expected_file_changes: task.relevant_files.clone(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
            TaskType::Bugfix => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Bug fix verification".into(),
                    input: task.description.clone(),
                    expected_patterns: vec!["fix".into()],
                    expected_file_changes: task.relevant_files.clone(),
                    expected_commands: vec!["test".into()],
                    weight: 1.0,
                },
            ],
            _ => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "General task test".into(),
                    input: task.description.clone(),
                    expected_patterns: Vec::new(),
                    expected_file_changes: Vec::new(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
        };

        Ok(Benchmark {
            id,
            name: format!("Benchmark for {}", task.description),
            task_spec: task.clone(),
            test_cases,
            timeout_seconds: 300,
        })
    }

    /// Get refinement suggestions based on test results.
    async fn get_suggestions(
        &self,
        _config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>> {
        let mut suggestions = Vec::new();

        // Analyze failed tests and generate suggestions
        for test_result in &results.test_results {
            if !test_result.passed {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::SystemPrompt,
                    change_type: ChangeType::Modify,
                    current_value: None,
                    suggested_value: format!("Add guidance for: {}", test_result.test_case_id),
                    rationale: format!("Test case {} failed", test_result.test_case_id),
                    expected_impact: 0.1,
                    confidence: 0.6,
                });
            }
        }

        Ok(suggestions)
    }

    /// Full optimization loop: BUILD → TEST → IMPROVE.
    async fn optimize(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
        options: Option<OptimizationOptions>,
    ) -> SDKResult<OptimizationResult> {
        let opts = options.unwrap_or_default();
        let start = std::time::Instant::now();
        let mut score_history = Vec::new();

        // BUILD initial config
        let mut config = self.build(task, context).await?;

        // Create benchmark
        let benchmark = self.create_benchmark(task, context).await?;

        let mut iterations = 0;
        let mut last_score = 0.0;

        while iterations < opts.max_iterations {
            iterations += 1;

            // TEST
            let results = self.test(&config, &benchmark).await?;
            score_history.push(results.score);

            // Check if target reached
            if results.score >= opts.target_score {
                return Ok(OptimizationResult {
                    config,
                    iterations,
                    final_score: results.score,
                    score_history,
                    total_duration_ms: start.elapsed().as_millis() as u64,
                    reached_target: true,
                    stop_reason: StopReason::TargetReached,
                });
            }

            // Check for improvement
            if iterations > 1 && results.score - last_score < opts.min_improvement {
                return Ok(OptimizationResult {
                    config,
                    iterations,
                    final_score: results.score,
                    score_history,
                    total_duration_ms: start.elapsed().as_millis() as u64,
                    reached_target: false,
                    stop_reason: StopReason::NoImprovement,
                });
            }

            last_score = results.score;

            // IMPROVE
            config = self.improve(&config, &results).await?;

            // Check timeout
            if start.elapsed().as_secs() >= opts.timeout_seconds {
                return Ok(OptimizationResult {
                    config,
                    iterations,
                    final_score: last_score,
                    score_history,
                    total_duration_ms: start.elapsed().as_millis() as u64,
                    reached_target: false,
                    stop_reason: StopReason::Timeout,
                });
            }
        }

        Ok(OptimizationResult {
            config,
            iterations,
            final_score: last_score,
            score_history,
            total_duration_ms: start.elapsed().as_millis() as u64,
            reached_target: false,
            stop_reason: StopReason::MaxIterations,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_agent() -> MetaAgent {
        let conn = Connection::open_in_memory().unwrap();
        let db = Arc::new(RwLock::new(conn));
        let config = MetaAgentConfig::default();

        MetaAgent::new(db, config)
    }

    #[tokio::test]
    async fn test_build() {
        let agent = setup_test_agent().await;

        let task = TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Add user authentication".into(),
            acceptance_criteria: vec!["Users can log in".into()],
            complexity: Some(5),
            relevant_files: vec!["src/auth.ts".into()],
            constraints: Vec::new(),
            beads_issue_id: None,
        };

        let context = ProjectContext {
            project_path: "/test/project".into(),
            project_type: "nextjs".into(),
            language: "typescript".into(),
            frameworks: vec!["react".into()],
            package_manager: "bun".into(),
            test_framework: Some("vitest".into()),
            linter: Some("eslint".into()),
            has_ci: true,
            current_branch: Some("main".into()),
            folder_id: None,
        };

        let config = agent.build(&task, &context).await.unwrap();

        assert!(!config.id.is_empty());
        assert!(config.system_prompt.contains("nextjs"));
        assert!(config.system_prompt.contains("authentication"));
    }

    #[tokio::test]
    async fn test_create_benchmark() {
        let agent = setup_test_agent().await;

        let task = TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Add feature X".into(),
            acceptance_criteria: vec!["Feature works".into()],
            complexity: None,
            relevant_files: Vec::new(),
            constraints: Vec::new(),
            beads_issue_id: None,
        };

        let context = ProjectContext {
            project_path: "/test".into(),
            project_type: "node".into(),
            language: "typescript".into(),
            frameworks: Vec::new(),
            package_manager: "npm".into(),
            test_framework: None,
            linter: None,
            has_ci: false,
            current_branch: None,
            folder_id: None,
        };

        let benchmark = agent.create_benchmark(&task, &context).await.unwrap();

        assert!(!benchmark.id.is_empty());
        assert_eq!(benchmark.test_cases.len(), 1);
        assert!(benchmark.test_cases[0].description.contains("Feature"));
    }

    #[tokio::test]
    async fn test_optimize_loop() {
        let agent = setup_test_agent().await;

        let task = TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Test task".into(),
            acceptance_criteria: Vec::new(),
            complexity: None,
            relevant_files: Vec::new(),
            constraints: Vec::new(),
            beads_issue_id: None,
        };

        let context = ProjectContext {
            project_path: "/test".into(),
            project_type: "node".into(),
            language: "typescript".into(),
            frameworks: Vec::new(),
            package_manager: "npm".into(),
            test_framework: None,
            linter: None,
            has_ci: false,
            current_branch: None,
            folder_id: None,
        };

        let options = OptimizationOptions {
            max_iterations: 2,
            target_score: 0.95,
            min_improvement: 0.01,
            timeout_seconds: 60,
            verbose: false,
            dry_run: false,
        };

        let result = agent.optimize(&task, &context, Some(options)).await.unwrap();

        assert!(result.iterations > 0);
        assert!(!result.score_history.is_empty());
    }
}
