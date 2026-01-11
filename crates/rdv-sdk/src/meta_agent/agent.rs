//! Meta-Agent Implementation
//!
//! Implements the BUILD → TEST → IMPROVE loop.

use std::sync::Arc;
use chrono::Utc;
use rusqlite::Connection;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{SDKResult, config::MetaAgentConfig};
use super::types::*;

/// Meta-agent for configuration optimization
#[allow(dead_code)]
pub struct MetaAgent {
    db: Arc<RwLock<Connection>>,
    config: MetaAgentConfig,
}

impl MetaAgent {
    /// Create a new meta-agent
    pub fn new(db: Arc<RwLock<Connection>>, config: MetaAgentConfig) -> Self {
        Self { db, config }
    }

    /// BUILD phase: Generate an agent configuration
    pub async fn build(&self, task: &TaskSpec, context: &ProjectContext) -> SDKResult<AgentConfig> {
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

    /// TEST phase: Evaluate a configuration
    pub async fn test(&self, config: &AgentConfig, benchmark: &Benchmark) -> SDKResult<BenchmarkResult> {
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

    /// IMPROVE phase: Refine configuration based on results
    pub async fn improve(&self, config: &AgentConfig, results: &BenchmarkResult) -> SDKResult<AgentConfig> {
        let suggestions = self.get_suggestions(config, results).await?;

        let mut improved = config.clone();
        improved.id = Uuid::new_v4().to_string();
        improved.version = config.version + 1;

        // Apply suggestions
        for suggestion in suggestions {
            if suggestion.confidence >= 0.5 {
                improved = self.apply_suggestion(&improved, &suggestion).await?;
            }
        }

        Ok(improved)
    }

    /// Full optimization loop
    pub async fn optimize(
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

    /// Create a benchmark for a task
    pub async fn create_benchmark(&self, task: &TaskSpec, _context: &ProjectContext) -> SDKResult<Benchmark> {
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

    /// Get refinement suggestions
    pub async fn get_suggestions(
        &self,
        _config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>> {
        let mut suggestions = Vec::new();

        // Analyze failed tests
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

    /// Apply a suggestion to a configuration
    pub async fn apply_suggestion(
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
            }
        }

        Ok(updated)
    }

    // Private helpers

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
        Ok(TestCaseResult {
            test_case_id: test_case.id.clone(),
            passed: true, // Placeholder
            score: 0.8, // Placeholder
            error: None,
            duration_ms: 100,
        })
    }
}

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
}
