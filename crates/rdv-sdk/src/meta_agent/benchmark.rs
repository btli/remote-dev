//! Benchmark Framework
//!
//! Provides benchmark execution strategies, scoring utilities, and
//! result analysis for evaluating agent configurations.

use async_trait::async_trait;
use chrono::Utc;
use uuid::Uuid;

use crate::SDKResult;
use super::traits::BenchmarkExecutor;
use super::types::{
    AgentConfig, Benchmark, BenchmarkResult, TestCase, TestCaseResult,
    TaskSpec, TaskType, ProjectContext,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock Benchmark Executor
// ─────────────────────────────────────────────────────────────────────────────

/// A mock benchmark executor for testing and development.
///
/// Returns configurable scores without actually executing agents.
/// Useful for:
/// - Unit testing the optimization loop
/// - Validating benchmark structure
/// - Development without real agent execution
pub struct MockBenchmarkExecutor {
    /// Base score to return (0.0 - 1.0)
    pub base_score: f64,
    /// Variance to add/subtract from base score randomly
    pub score_variance: f64,
    /// Whether all tests should pass
    pub all_pass: bool,
    /// Simulated execution time in milliseconds
    pub simulated_duration_ms: u64,
}

impl Default for MockBenchmarkExecutor {
    fn default() -> Self {
        Self {
            base_score: 0.8,
            score_variance: 0.1,
            all_pass: true,
            simulated_duration_ms: 100,
        }
    }
}

impl MockBenchmarkExecutor {
    /// Create a new mock executor with all tests passing
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a failing mock executor for testing failure paths
    pub fn failing() -> Self {
        Self {
            base_score: 0.3,
            score_variance: 0.1,
            all_pass: false,
            simulated_duration_ms: 100,
        }
    }

    /// Create a high-scoring mock executor
    pub fn high_scoring() -> Self {
        Self {
            base_score: 0.95,
            score_variance: 0.02,
            all_pass: true,
            simulated_duration_ms: 50,
        }
    }
}

#[async_trait(?Send)]
impl BenchmarkExecutor for MockBenchmarkExecutor {
    async fn execute_test_case(
        &self,
        _config: &AgentConfig,
        test_case: &TestCase,
    ) -> SDKResult<TestCaseResult> {
        // Generate a score within the configured range
        let score = (self.base_score + (rand_variance() * self.score_variance))
            .max(0.0)
            .min(1.0);

        let passed = if self.all_pass {
            true
        } else {
            score >= 0.7
        };

        Ok(TestCaseResult {
            test_case_id: test_case.id.clone(),
            passed,
            score,
            error: if passed { None } else { Some("Mock failure".into()) },
            duration_ms: self.simulated_duration_ms,
        })
    }

    fn is_sandboxed(&self) -> bool {
        true // Mock executor is always "sandboxed"
    }

    fn timeout_seconds(&self) -> u64 {
        60 // Default timeout for mock tests
    }
}

/// Simple deterministic "random" for testing (not cryptographically secure)
fn rand_variance() -> f64 {
    // Use time-based pseudo-randomness for variance
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);

    // Map to -1.0 to 1.0 range
    ((nanos % 1000) as f64 / 500.0) - 1.0
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern-Based Executor
// ─────────────────────────────────────────────────────────────────────────────

/// A benchmark executor that scores based on pattern matching.
///
/// Evaluates test cases by checking if the config's system prompt
/// and instructions contain expected patterns.
pub struct PatternBasedExecutor {
    /// Weight for pattern matches in system prompt (0.0 - 1.0)
    pub prompt_weight: f64,
    /// Weight for pattern matches in instructions (0.0 - 1.0)
    pub instructions_weight: f64,
    /// Simulated execution time in milliseconds
    pub simulated_duration_ms: u64,
}

impl Default for PatternBasedExecutor {
    fn default() -> Self {
        Self {
            prompt_weight: 0.4,
            instructions_weight: 0.6,
            simulated_duration_ms: 50,
        }
    }
}

#[async_trait(?Send)]
impl BenchmarkExecutor for PatternBasedExecutor {
    async fn execute_test_case(
        &self,
        config: &AgentConfig,
        test_case: &TestCase,
    ) -> SDKResult<TestCaseResult> {
        let mut score = 0.0;
        let mut matches_found = 0;
        let total_patterns = test_case.expected_patterns.len();

        if total_patterns == 0 {
            // No patterns to check, assume pass
            return Ok(TestCaseResult {
                test_case_id: test_case.id.clone(),
                passed: true,
                score: 1.0,
                error: None,
                duration_ms: self.simulated_duration_ms,
            });
        }

        // Check patterns in system prompt and instructions
        for pattern in &test_case.expected_patterns {
            let pattern_lower = pattern.to_lowercase();

            let in_prompt = config.system_prompt.to_lowercase().contains(&pattern_lower);
            let in_instructions = config.instructions_file.to_lowercase().contains(&pattern_lower);

            if in_prompt {
                score += self.prompt_weight;
                matches_found += 1;
            }
            if in_instructions {
                score += self.instructions_weight;
                if !in_prompt {
                    matches_found += 1;
                }
            }
        }

        // Normalize score to 0.0 - 1.0 range
        let normalized_score = if total_patterns > 0 {
            (score / (total_patterns as f64 * (self.prompt_weight + self.instructions_weight)))
                .min(1.0)
        } else {
            1.0
        };

        // Pass if all patterns are found (regardless of where)
        // Score reflects quality (patterns in both prompt and instructions score higher)
        let passed = matches_found == total_patterns;

        Ok(TestCaseResult {
            test_case_id: test_case.id.clone(),
            passed,
            score: normalized_score,
            error: if passed {
                None
            } else {
                Some(format!(
                    "Only {}/{} patterns matched (score: {:.2})",
                    matches_found, total_patterns, normalized_score
                ))
            },
            duration_ms: self.simulated_duration_ms,
        })
    }

    fn is_sandboxed(&self) -> bool {
        true // Pattern matching is sandboxed (no execution)
    }

    fn timeout_seconds(&self) -> u64 {
        30 // Quick timeout for pattern matching
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark Builder
// ─────────────────────────────────────────────────────────────────────────────

/// Builder for creating benchmarks from task specifications.
///
/// Generates appropriate test cases based on task type and context.
pub struct BenchmarkBuilder {
    task: TaskSpec,
    context: Option<ProjectContext>,
    custom_test_cases: Vec<TestCase>,
    timeout_seconds: u64,
}

impl BenchmarkBuilder {
    /// Create a new benchmark builder for a task
    pub fn new(task: TaskSpec) -> Self {
        Self {
            task,
            context: None,
            custom_test_cases: Vec::new(),
            timeout_seconds: 300,
        }
    }

    /// Set the project context for context-aware test generation
    pub fn with_context(mut self, context: ProjectContext) -> Self {
        self.context = Some(context);
        self
    }

    /// Add a custom test case
    pub fn add_test_case(mut self, test_case: TestCase) -> Self {
        self.custom_test_cases.push(test_case);
        self
    }

    /// Set the timeout for benchmark execution
    pub fn with_timeout(mut self, seconds: u64) -> Self {
        self.timeout_seconds = seconds;
        self
    }

    /// Build the benchmark
    pub fn build(self) -> Benchmark {
        // Generate all test cases while self is still borrowed
        let task_type_tests = self.generate_task_type_tests();
        let acceptance_tests = self.generate_acceptance_tests();
        let context_tests = if let Some(ref context) = self.context {
            self.generate_context_tests(context)
        } else {
            Vec::new()
        };

        // Now we can destructure and move custom_test_cases
        let BenchmarkBuilder {
            task,
            custom_test_cases,
            timeout_seconds,
            ..
        } = self;

        // Combine all test cases
        let mut test_cases = custom_test_cases;
        test_cases.extend(task_type_tests);
        test_cases.extend(acceptance_tests);
        test_cases.extend(context_tests);

        Benchmark {
            id: Uuid::new_v4().to_string(),
            name: format!("Benchmark for: {}", task.description),
            task_spec: task,
            test_cases,
            timeout_seconds,
        }
    }

    fn generate_task_type_tests(&self) -> Vec<TestCase> {
        match self.task.task_type {
            TaskType::Feature => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Feature implementation guidance".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "feature".into(),
                        "implement".into(),
                    ],
                    expected_file_changes: self.task.relevant_files.clone(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
            TaskType::Bugfix => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Bug fix approach".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "bug".into(),
                        "fix".into(),
                        "root cause".into(),
                    ],
                    expected_file_changes: self.task.relevant_files.clone(),
                    expected_commands: vec!["test".into()],
                    weight: 1.0,
                },
            ],
            TaskType::Refactor => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Refactoring guidelines".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "refactor".into(),
                        "behavior".into(),
                        "test".into(),
                    ],
                    expected_file_changes: self.task.relevant_files.clone(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
            TaskType::Test => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Testing best practices".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "test".into(),
                        "coverage".into(),
                        "edge case".into(),
                    ],
                    expected_file_changes: Vec::new(),
                    expected_commands: vec!["test".into()],
                    weight: 1.0,
                },
            ],
            TaskType::Docs => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Documentation guidelines".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "document".into(),
                        "example".into(),
                    ],
                    expected_file_changes: Vec::new(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
            TaskType::Review => vec![
                TestCase {
                    id: Uuid::new_v4().to_string(),
                    description: "Code review criteria".into(),
                    input: self.task.description.clone(),
                    expected_patterns: vec![
                        "review".into(),
                        "quality".into(),
                    ],
                    expected_file_changes: Vec::new(),
                    expected_commands: Vec::new(),
                    weight: 1.0,
                },
            ],
        }
    }

    fn generate_acceptance_tests(&self) -> Vec<TestCase> {
        if self.task.acceptance_criteria.is_empty() {
            return Vec::new();
        }

        vec![TestCase {
            id: Uuid::new_v4().to_string(),
            description: "Acceptance criteria coverage".into(),
            input: self.task.description.clone(),
            expected_patterns: self.task.acceptance_criteria.clone(),
            expected_file_changes: Vec::new(),
            expected_commands: Vec::new(),
            weight: 2.0, // Higher weight for acceptance criteria
        }]
    }

    fn generate_context_tests(&self, context: &ProjectContext) -> Vec<TestCase> {
        let mut tests = Vec::new();

        // Language-specific test
        tests.push(TestCase {
            id: Uuid::new_v4().to_string(),
            description: format!("{} language guidance", context.language),
            input: format!("Check {} specific guidance", context.language),
            expected_patterns: vec![context.language.clone()],
            expected_file_changes: Vec::new(),
            expected_commands: Vec::new(),
            weight: 0.5,
        });

        // Package manager test
        tests.push(TestCase {
            id: Uuid::new_v4().to_string(),
            description: "Package manager commands".into(),
            input: "Check package manager integration".into(),
            expected_patterns: vec![context.package_manager.clone()],
            expected_file_changes: Vec::new(),
            expected_commands: vec![
                format!("{} install", context.package_manager),
                format!("{} run", context.package_manager),
            ],
            weight: 0.5,
        });

        tests
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Analyze benchmark results and provide insights
pub struct BenchmarkAnalyzer;

impl BenchmarkAnalyzer {
    /// Calculate weighted average score from test results
    pub fn calculate_weighted_score(results: &[TestCaseResult], test_cases: &[TestCase]) -> f64 {
        if results.is_empty() {
            return 0.0;
        }

        let mut total_weighted_score = 0.0;
        let mut total_weight = 0.0;

        for result in results {
            // Find the corresponding test case weight
            let weight = test_cases
                .iter()
                .find(|tc| tc.id == result.test_case_id)
                .map(|tc| tc.weight)
                .unwrap_or(1.0);

            total_weighted_score += result.score * weight;
            total_weight += weight;
        }

        if total_weight > 0.0 {
            total_weighted_score / total_weight
        } else {
            0.0
        }
    }

    /// Get pass rate as percentage
    pub fn calculate_pass_rate(results: &[TestCaseResult]) -> f64 {
        if results.is_empty() {
            return 0.0;
        }

        let passed = results.iter().filter(|r| r.passed).count();
        (passed as f64 / results.len() as f64) * 100.0
    }

    /// Identify failing test cases
    pub fn get_failing_tests(results: &[TestCaseResult]) -> Vec<&TestCaseResult> {
        results.iter().filter(|r| !r.passed).collect()
    }

    /// Generate a summary of the benchmark results
    pub fn summarize(result: &BenchmarkResult, benchmark: &Benchmark) -> BenchmarkSummary {
        let pass_rate = Self::calculate_pass_rate(&result.test_results);
        let failing_tests = Self::get_failing_tests(&result.test_results);
        let weighted_score = Self::calculate_weighted_score(&result.test_results, &benchmark.test_cases);

        BenchmarkSummary {
            total_tests: result.test_results.len(),
            passed_tests: result.test_results.iter().filter(|r| r.passed).count(),
            failed_tests: failing_tests.len(),
            pass_rate,
            weighted_score,
            total_duration_ms: result.duration_ms,
            errors: failing_tests.iter()
                .filter_map(|r| r.error.clone())
                .collect(),
        }
    }
}

/// Summary of benchmark results
#[derive(Debug, Clone)]
pub struct BenchmarkSummary {
    pub total_tests: usize,
    pub passed_tests: usize,
    pub failed_tests: usize,
    pub pass_rate: f64,
    pub weighted_score: f64,
    pub total_duration_ms: u64,
    pub errors: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

/// Run a benchmark against a configuration using a specific executor
pub async fn run_benchmark<E: BenchmarkExecutor>(
    config: &AgentConfig,
    benchmark: &Benchmark,
    executor: &E,
) -> SDKResult<BenchmarkResult> {
    let start = std::time::Instant::now();
    let mut test_results = Vec::new();
    let mut errors = Vec::new();

    for test_case in &benchmark.test_cases {
        match executor.execute_test_case(config, test_case).await {
            Ok(result) => {
                if let Some(ref error) = result.error {
                    errors.push(error.clone());
                }
                test_results.push(result);
            }
            Err(e) => {
                errors.push(e.to_string());
                test_results.push(TestCaseResult {
                    test_case_id: test_case.id.clone(),
                    passed: false,
                    score: 0.0,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                });
            }
        }
    }

    let score = BenchmarkAnalyzer::calculate_weighted_score(&test_results, &benchmark.test_cases);
    let passed = score >= 0.7 && errors.is_empty();

    Ok(BenchmarkResult {
        benchmark_id: benchmark.id.clone(),
        config_id: config.id.clone(),
        score,
        passed,
        test_results,
        duration_ms: start.elapsed().as_millis() as u64,
        errors,
        warnings: Vec::new(),
        files_modified: Vec::new(),
        commands_executed: Vec::new(),
        executed_at: Utc::now(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> AgentConfig {
        AgentConfig {
            id: "config-1".into(),
            name: "Test Config".into(),
            provider: super::super::types::AgentProvider::Claude,
            task_spec: sample_task(),
            project_context: sample_context(),
            system_prompt: "You are working on a typescript nextjs project. Implement new features following best practices.".into(),
            instructions_file: "# CLAUDE.md\n\nFollow testing guidelines and ensure coverage.".into(),
            version: 1,
            created_at: Utc::now(),
        }
    }

    fn sample_task() -> TaskSpec {
        TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Add user authentication".into(),
            acceptance_criteria: vec!["Users can sign in".into()],
            complexity: Some(5),
            relevant_files: vec!["src/auth.ts".into()],
            constraints: Vec::new(),
            beads_issue_id: None,
        }
    }

    fn sample_context() -> ProjectContext {
        ProjectContext {
            project_path: "/test".into(),
            project_type: "nextjs".into(),
            language: "typescript".into(),
            frameworks: vec!["react".into()],
            package_manager: "bun".into(),
            test_framework: Some("vitest".into()),
            linter: Some("eslint".into()),
            has_ci: true,
            current_branch: None,
            folder_id: None,
        }
    }

    #[tokio::test]
    async fn test_mock_executor_default() {
        let executor = MockBenchmarkExecutor::default();
        let config = sample_config();
        let test_case = TestCase {
            id: "test-1".into(),
            description: "Test case".into(),
            input: "input".into(),
            expected_patterns: Vec::new(),
            expected_file_changes: Vec::new(),
            expected_commands: Vec::new(),
            weight: 1.0,
        };

        let result = executor.execute_test_case(&config, &test_case).await.unwrap();

        assert!(result.passed);
        assert!(result.score >= 0.5);
        assert_eq!(result.duration_ms, 100);
    }

    #[tokio::test]
    async fn test_mock_executor_failing() {
        let executor = MockBenchmarkExecutor::failing();
        let config = sample_config();
        let test_case = TestCase {
            id: "test-1".into(),
            description: "Test case".into(),
            input: "input".into(),
            expected_patterns: Vec::new(),
            expected_file_changes: Vec::new(),
            expected_commands: Vec::new(),
            weight: 1.0,
        };

        let result = executor.execute_test_case(&config, &test_case).await.unwrap();

        // Low score, should fail
        assert!(!result.passed || result.score < 0.5);
    }

    #[tokio::test]
    async fn test_pattern_executor() {
        let executor = PatternBasedExecutor::default();
        let config = sample_config();
        let test_case = TestCase {
            id: "test-1".into(),
            description: "Check typescript".into(),
            input: "input".into(),
            expected_patterns: vec!["typescript".into(), "nextjs".into()],
            expected_file_changes: Vec::new(),
            expected_commands: Vec::new(),
            weight: 1.0,
        };

        let result = executor.execute_test_case(&config, &test_case).await.unwrap();

        // Should pass because both patterns are in the config
        assert!(result.passed);
        // Score is 0.4 because patterns are only in prompt (not instructions)
        // With prompt_weight=0.4: 2 patterns × 0.4 / (2 × 1.0) = 0.4
        assert!(result.score > 0.0);
        assert!(result.score <= 1.0);
    }

    #[tokio::test]
    async fn test_benchmark_builder() {
        let task = sample_task();
        let context = sample_context();

        let benchmark = BenchmarkBuilder::new(task)
            .with_context(context)
            .with_timeout(120)
            .build();

        assert!(!benchmark.id.is_empty());
        assert!(!benchmark.test_cases.is_empty());
        assert_eq!(benchmark.timeout_seconds, 120);
    }

    #[tokio::test]
    async fn test_run_benchmark() {
        let config = sample_config();
        let task = sample_task();

        let benchmark = BenchmarkBuilder::new(task).build();
        let executor = MockBenchmarkExecutor::high_scoring();

        let result = run_benchmark(&config, &benchmark, &executor).await.unwrap();

        assert!(result.score > 0.8);
        assert!(result.passed);
        assert!(!result.test_results.is_empty());
    }

    #[test]
    fn test_analyzer_scoring() {
        let results = vec![
            TestCaseResult {
                test_case_id: "1".into(),
                passed: true,
                score: 0.9,
                error: None,
                duration_ms: 50,
            },
            TestCaseResult {
                test_case_id: "2".into(),
                passed: true,
                score: 0.7,
                error: None,
                duration_ms: 50,
            },
        ];

        let test_cases = vec![
            TestCase {
                id: "1".into(),
                description: "".into(),
                input: "".into(),
                expected_patterns: Vec::new(),
                expected_file_changes: Vec::new(),
                expected_commands: Vec::new(),
                weight: 2.0,
            },
            TestCase {
                id: "2".into(),
                description: "".into(),
                input: "".into(),
                expected_patterns: Vec::new(),
                expected_file_changes: Vec::new(),
                expected_commands: Vec::new(),
                weight: 1.0,
            },
        ];

        let weighted_score = BenchmarkAnalyzer::calculate_weighted_score(&results, &test_cases);

        // (0.9 * 2.0 + 0.7 * 1.0) / (2.0 + 1.0) = 2.5 / 3.0 ≈ 0.833
        assert!((weighted_score - 0.833).abs() < 0.01);
    }

    #[test]
    fn test_pass_rate() {
        let results = vec![
            TestCaseResult { test_case_id: "1".into(), passed: true, score: 0.9, error: None, duration_ms: 0 },
            TestCaseResult { test_case_id: "2".into(), passed: true, score: 0.8, error: None, duration_ms: 0 },
            TestCaseResult { test_case_id: "3".into(), passed: false, score: 0.3, error: Some("failed".into()), duration_ms: 0 },
        ];

        let pass_rate = BenchmarkAnalyzer::calculate_pass_rate(&results);

        // 2/3 = 66.67%
        assert!((pass_rate - 66.67).abs() < 0.1);
    }
}
