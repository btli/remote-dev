//! Refinement Strategies for the IMPROVE Phase
//!
//! This module provides implementations of the `RefinementStrategy` trait
//! for analyzing benchmark results and generating configuration improvements.
//!
//! # Architecture
//!
//! - [`RuleBasedStrategy`] - Pattern-matching based improvements
//! - [`ScoreBasedStrategy`] - Uses benchmark scores to prioritize improvements
//! - [`CompositeStrategy`] - Combines multiple strategies
//!
//! # Example
//!
//! ```rust,ignore
//! use rdv_sdk::meta_agent::{RuleBasedStrategy, RefinementStrategy};
//!
//! let strategy = RuleBasedStrategy::default();
//! let suggestions = strategy.analyze(&config, &results).await?;
//!
//! for suggestion in suggestions {
//!     if suggestion.confidence >= strategy.min_confidence() {
//!         let improved = strategy.apply_suggestion(&config, &suggestion).await?;
//!     }
//! }
//! ```

use async_trait::async_trait;
use uuid::Uuid;

use crate::SDKResult;
use super::traits::RefinementStrategy;
use super::types::{
    AgentConfig, BenchmarkResult, ChangeType, RefinementSuggestion,
    RefinementTarget, TaskType, TestCaseResult,
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule-Based Strategy
// ─────────────────────────────────────────────────────────────────────────────

/// Rule-based refinement strategy that uses pattern matching to identify
/// improvement opportunities.
///
/// This strategy analyzes failed test cases and applies predefined rules
/// to generate suggestions for improving the configuration.
#[derive(Debug, Clone)]
pub struct RuleBasedStrategy {
    /// Minimum confidence threshold for applying suggestions
    pub min_confidence: f64,
    /// Whether to include low-confidence suggestions in results
    pub include_low_confidence: bool,
}

impl Default for RuleBasedStrategy {
    fn default() -> Self {
        Self {
            min_confidence: 0.5,
            include_low_confidence: true,
        }
    }
}

impl RuleBasedStrategy {
    /// Create a new rule-based strategy with custom confidence threshold
    pub fn with_min_confidence(min_confidence: f64) -> Self {
        Self {
            min_confidence,
            include_low_confidence: true,
        }
    }

    /// Analyze a single test case result for improvement opportunities
    fn analyze_test_case(
        &self,
        config: &AgentConfig,
        test_result: &TestCaseResult,
    ) -> Vec<RefinementSuggestion> {
        let mut suggestions = Vec::new();

        if test_result.passed {
            return suggestions;
        }

        // Rule 1: Low score suggests missing guidance
        if test_result.score < 0.3 {
            suggestions.push(RefinementSuggestion {
                id: Uuid::new_v4().to_string(),
                target: RefinementTarget::SystemPrompt,
                change_type: ChangeType::Modify,
                current_value: Some(config.system_prompt.clone()),
                suggested_value: format!(
                    "{}\n\n## Additional Guidance\nPay special attention to: {}",
                    config.system_prompt,
                    test_result.test_case_id
                ),
                rationale: format!(
                    "Test case '{}' scored very low ({:.2}), suggesting fundamental gaps in guidance",
                    test_result.test_case_id, test_result.score
                ),
                expected_impact: 0.3,
                confidence: 0.7,
            });
        }

        // Rule 2: Error message analysis
        if let Some(ref error) = test_result.error {
            let error_lower = error.to_lowercase();

            // Missing pattern errors
            if error_lower.contains("pattern") || error_lower.contains("missing") {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::Instructions,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.instructions_file.clone()),
                    suggested_value: format!(
                        "{}\n\n## Required Patterns\nEnsure the following are addressed:\n- {}",
                        config.instructions_file,
                        test_result.test_case_id
                    ),
                    rationale: format!("Missing pattern detected: {}", error),
                    expected_impact: 0.2,
                    confidence: 0.6,
                });
            }

            // Timeout errors
            if error_lower.contains("timeout") || error_lower.contains("time") {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::SystemPrompt,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.system_prompt.clone()),
                    suggested_value: format!(
                        "{}\n\nIMPORTANT: Work efficiently and avoid unnecessary complexity.",
                        config.system_prompt
                    ),
                    rationale: "Timeout suggests the agent may be overcomplicating tasks".into(),
                    expected_impact: 0.15,
                    confidence: 0.5,
                });
            }
        }

        // Rule 3: Task-type specific improvements
        suggestions.extend(self.task_type_suggestions(config, test_result));

        suggestions
    }

    /// Generate suggestions based on task type
    fn task_type_suggestions(
        &self,
        config: &AgentConfig,
        test_result: &TestCaseResult,
    ) -> Vec<RefinementSuggestion> {
        let mut suggestions = Vec::new();

        match config.task_spec.task_type {
            TaskType::Feature => {
                if test_result.score < 0.5 {
                    suggestions.push(RefinementSuggestion {
                        id: Uuid::new_v4().to_string(),
                        target: RefinementTarget::Instructions,
                        change_type: ChangeType::Modify,
                        current_value: Some(config.instructions_file.clone()),
                        suggested_value: format!(
                            "{}\n\n## Feature Implementation Guidelines\n\
                            1. Start with the core functionality\n\
                            2. Add error handling\n\
                            3. Include tests\n\
                            4. Update documentation",
                            config.instructions_file
                        ),
                        rationale: "Feature implementation needs structured guidance".into(),
                        expected_impact: 0.25,
                        confidence: 0.65,
                    });
                }
            }
            TaskType::Bugfix => {
                if test_result.score < 0.5 {
                    suggestions.push(RefinementSuggestion {
                        id: Uuid::new_v4().to_string(),
                        target: RefinementTarget::SystemPrompt,
                        change_type: ChangeType::Modify,
                        current_value: Some(config.system_prompt.clone()),
                        suggested_value: format!(
                            "{}\n\nWhen fixing bugs:\n\
                            1. Reproduce the issue first\n\
                            2. Identify root cause\n\
                            3. Fix without introducing regressions\n\
                            4. Add test to prevent recurrence",
                            config.system_prompt
                        ),
                        rationale: "Bug fixes need systematic approach guidance".into(),
                        expected_impact: 0.3,
                        confidence: 0.7,
                    });
                }
            }
            TaskType::Refactor => {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::Instructions,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.instructions_file.clone()),
                    suggested_value: format!(
                        "{}\n\n## Refactoring Guidelines\n\
                        - Maintain backward compatibility\n\
                        - Run tests after each change\n\
                        - Keep commits small and focused",
                        config.instructions_file
                    ),
                    rationale: "Refactoring benefits from safety guidelines".into(),
                    expected_impact: 0.2,
                    confidence: 0.6,
                });
            }
            TaskType::Docs => {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::Instructions,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.instructions_file.clone()),
                    suggested_value: format!(
                        "{}\n\n## Documentation Standards\n\
                        - Use clear, concise language\n\
                        - Include examples\n\
                        - Keep code samples up to date",
                        config.instructions_file
                    ),
                    rationale: "Documentation needs quality standards".into(),
                    expected_impact: 0.15,
                    confidence: 0.55,
                });
            }
            TaskType::Test => {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::Instructions,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.instructions_file.clone()),
                    suggested_value: format!(
                        "{}\n\n## Testing Guidelines\n\
                        - Cover edge cases\n\
                        - Test error conditions\n\
                        - Use meaningful test names\n\
                        - Keep tests independent",
                        config.instructions_file
                    ),
                    rationale: "Test tasks need comprehensive guidelines".into(),
                    expected_impact: 0.2,
                    confidence: 0.6,
                });
            }
            TaskType::Review => {
                // Generic suggestions for review tasks
                if test_result.score < 0.4 {
                    suggestions.push(RefinementSuggestion {
                        id: Uuid::new_v4().to_string(),
                        target: RefinementTarget::SystemPrompt,
                        change_type: ChangeType::Modify,
                        current_value: Some(config.system_prompt.clone()),
                        suggested_value: format!(
                            "{}\n\nBe thorough and systematic in your review.",
                            config.system_prompt
                        ),
                        rationale: "Review task needs more structured guidance".into(),
                        expected_impact: 0.1,
                        confidence: 0.4,
                    });
                }
            }
        }

        suggestions
    }
}

#[async_trait(?Send)]
impl RefinementStrategy for RuleBasedStrategy {
    async fn analyze(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>> {
        let mut all_suggestions = Vec::new();

        // Analyze each failed test case
        for test_result in &results.test_results {
            let suggestions = self.analyze_test_case(config, test_result);
            all_suggestions.extend(suggestions);
        }

        // Filter by confidence if configured
        if !self.include_low_confidence {
            all_suggestions.retain(|s| s.confidence >= self.min_confidence);
        }

        // Sort by expected impact (highest first)
        all_suggestions.sort_by(|a, b| {
            b.expected_impact
                .partial_cmp(&a.expected_impact)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Deduplicate similar suggestions
        all_suggestions = deduplicate_suggestions(all_suggestions);

        Ok(all_suggestions)
    }

    async fn apply_suggestion(
        &self,
        config: &AgentConfig,
        suggestion: &RefinementSuggestion,
    ) -> SDKResult<AgentConfig> {
        let mut updated = config.clone();
        updated.id = Uuid::new_v4().to_string();
        updated.version = config.version + 1;

        match suggestion.target {
            RefinementTarget::SystemPrompt => {
                updated.system_prompt = suggestion.suggested_value.clone();
            }
            RefinementTarget::Instructions => {
                updated.instructions_file = suggestion.suggested_value.clone();
            }
            RefinementTarget::ToolConfig => {
                // Tool config is embedded in system prompt for now
                updated.system_prompt = format!(
                    "{}\n\n## Tool Configuration\n{}",
                    config.system_prompt, suggestion.suggested_value
                );
            }
            RefinementTarget::MemoryConfig => {
                // Memory config embedded in instructions
                updated.instructions_file = format!(
                    "{}\n\n## Memory Configuration\n{}",
                    config.instructions_file, suggestion.suggested_value
                );
            }
            RefinementTarget::McpConfig => {
                // MCP config guidance in system prompt
                updated.system_prompt = format!(
                    "{}\n\n## MCP Configuration\n{}",
                    config.system_prompt, suggestion.suggested_value
                );
            }
        }

        Ok(updated)
    }

    fn min_confidence(&self) -> f64 {
        self.min_confidence
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Score-Based Strategy
// ─────────────────────────────────────────────────────────────────────────────

/// Score-based refinement strategy that uses benchmark scores to prioritize
/// improvement areas.
///
/// This strategy focuses on the overall score and identifies which aspects
/// of the configuration need the most improvement.
#[derive(Debug, Clone)]
pub struct ScoreBasedStrategy {
    /// Target score to aim for
    pub target_score: f64,
    /// Minimum confidence threshold
    pub min_confidence: f64,
}

impl Default for ScoreBasedStrategy {
    fn default() -> Self {
        Self {
            target_score: 0.8,
            min_confidence: 0.5,
        }
    }
}

impl ScoreBasedStrategy {
    /// Create with custom target score
    pub fn with_target(target_score: f64) -> Self {
        Self {
            target_score,
            min_confidence: 0.5,
        }
    }

    /// Calculate score gap and generate proportional suggestions
    fn analyze_score_gap(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> Vec<RefinementSuggestion> {
        let mut suggestions = Vec::new();
        let score_gap = self.target_score - results.score;

        if score_gap <= 0.0 {
            return suggestions; // Already at or above target
        }

        // The larger the gap, the more aggressive the suggestions
        let urgency = (score_gap / self.target_score).min(1.0);

        // System prompt improvements for large gaps
        if score_gap > 0.3 {
            suggestions.push(RefinementSuggestion {
                id: Uuid::new_v4().to_string(),
                target: RefinementTarget::SystemPrompt,
                change_type: ChangeType::Modify,
                current_value: Some(config.system_prompt.clone()),
                suggested_value: self.enhance_system_prompt(config, urgency),
                rationale: format!(
                    "Score gap of {:.1}% requires significant prompt enhancement",
                    score_gap * 100.0
                ),
                expected_impact: urgency * 0.4,
                confidence: 0.7,
            });
        }

        // Instructions improvements for medium gaps
        if score_gap > 0.15 {
            suggestions.push(RefinementSuggestion {
                id: Uuid::new_v4().to_string(),
                target: RefinementTarget::Instructions,
                change_type: ChangeType::Modify,
                current_value: Some(config.instructions_file.clone()),
                suggested_value: self.enhance_instructions(config, urgency),
                rationale: format!(
                    "Score gap of {:.1}% suggests instructions need enhancement",
                    score_gap * 100.0
                ),
                expected_impact: urgency * 0.3,
                confidence: 0.6,
            });
        }

        suggestions
    }

    fn enhance_system_prompt(&self, config: &AgentConfig, urgency: f64) -> String {
        let mut enhanced = config.system_prompt.clone();

        // Add urgency-based enhancements
        if urgency > 0.5 {
            enhanced = format!(
                "{}\n\n## Critical Success Factors\n\
                Focus on these key areas:\n\
                1. Thoroughly understand the task before starting\n\
                2. Break complex tasks into smaller steps\n\
                3. Validate your work before completing",
                enhanced
            );
        }

        // Add task-specific context
        enhanced = format!(
            "{}\n\n## Task Context\n\
            Task Type: {:?}\n\
            Description: {}",
            enhanced,
            config.task_spec.task_type,
            config.task_spec.description
        );

        enhanced
    }

    fn enhance_instructions(&self, config: &AgentConfig, urgency: f64) -> String {
        let mut enhanced = config.instructions_file.clone();

        if urgency > 0.3 {
            // Add acceptance criteria emphasis
            if !config.task_spec.acceptance_criteria.is_empty() {
                enhanced = format!(
                    "{}\n\n## Acceptance Criteria (MUST COMPLETE)\n{}",
                    enhanced,
                    config
                        .task_spec
                        .acceptance_criteria
                        .iter()
                        .map(|c| format!("- [ ] {}", c))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
            }

            // Add constraints
            if !config.task_spec.constraints.is_empty() {
                enhanced = format!(
                    "{}\n\n## Constraints (DO NOT VIOLATE)\n{}",
                    enhanced,
                    config
                        .task_spec
                        .constraints
                        .iter()
                        .map(|c| format!("- {}", c))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
            }
        }

        enhanced
    }
}

#[async_trait(?Send)]
impl RefinementStrategy for ScoreBasedStrategy {
    async fn analyze(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>> {
        let mut suggestions = self.analyze_score_gap(config, results);

        // Also analyze individual test failures
        for test_result in &results.test_results {
            if !test_result.passed && test_result.score < 0.5 {
                suggestions.push(RefinementSuggestion {
                    id: Uuid::new_v4().to_string(),
                    target: RefinementTarget::Instructions,
                    change_type: ChangeType::Modify,
                    current_value: Some(config.instructions_file.clone()),
                    suggested_value: format!(
                        "{}\n\n## Focus Area: {}\nThis area needs improvement.",
                        config.instructions_file, test_result.test_case_id
                    ),
                    rationale: format!(
                        "Test '{}' scored {:.1}%, below threshold",
                        test_result.test_case_id,
                        test_result.score * 100.0
                    ),
                    expected_impact: 0.15,
                    confidence: 0.55,
                });
            }
        }

        suggestions.sort_by(|a, b| {
            b.expected_impact
                .partial_cmp(&a.expected_impact)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(suggestions)
    }

    async fn apply_suggestion(
        &self,
        config: &AgentConfig,
        suggestion: &RefinementSuggestion,
    ) -> SDKResult<AgentConfig> {
        let mut updated = config.clone();
        updated.id = Uuid::new_v4().to_string();
        updated.version = config.version + 1;

        match suggestion.target {
            RefinementTarget::SystemPrompt => {
                updated.system_prompt = suggestion.suggested_value.clone();
            }
            RefinementTarget::Instructions => {
                updated.instructions_file = suggestion.suggested_value.clone();
            }
            _ => {
                // Other targets: append to instructions
                updated.instructions_file = format!(
                    "{}\n\n{}",
                    config.instructions_file, suggestion.suggested_value
                );
            }
        }

        Ok(updated)
    }

    fn min_confidence(&self) -> f64 {
        self.min_confidence
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Strategy
// ─────────────────────────────────────────────────────────────────────────────

/// Composite strategy that combines multiple refinement strategies.
///
/// Useful for getting a comprehensive set of suggestions from different
/// analysis approaches.
pub struct CompositeStrategy {
    strategies: Vec<Box<dyn RefinementStrategy>>,
    min_confidence: f64,
}

impl CompositeStrategy {
    /// Create a new composite strategy
    pub fn new() -> Self {
        Self {
            strategies: Vec::new(),
            min_confidence: 0.5,
        }
    }

    /// Add a strategy to the composite
    pub fn add_strategy(mut self, strategy: Box<dyn RefinementStrategy>) -> Self {
        self.strategies.push(strategy);
        self
    }

    /// Create default composite with rule-based and score-based strategies
    pub fn default_composite() -> Self {
        Self::new()
            .add_strategy(Box::new(RuleBasedStrategy::default()))
            .add_strategy(Box::new(ScoreBasedStrategy::default()))
    }

    /// Set minimum confidence threshold
    pub fn with_min_confidence(mut self, min_confidence: f64) -> Self {
        self.min_confidence = min_confidence;
        self
    }
}

impl Default for CompositeStrategy {
    fn default() -> Self {
        Self::default_composite()
    }
}

#[async_trait(?Send)]
impl RefinementStrategy for CompositeStrategy {
    async fn analyze(
        &self,
        config: &AgentConfig,
        results: &BenchmarkResult,
    ) -> SDKResult<Vec<RefinementSuggestion>> {
        let mut all_suggestions = Vec::new();

        // Collect suggestions from all strategies
        for strategy in &self.strategies {
            let suggestions = strategy.analyze(config, results).await?;
            all_suggestions.extend(suggestions);
        }

        // Deduplicate and sort
        all_suggestions = deduplicate_suggestions(all_suggestions);
        all_suggestions.sort_by(|a, b| {
            b.expected_impact
                .partial_cmp(&a.expected_impact)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(all_suggestions)
    }

    async fn apply_suggestion(
        &self,
        config: &AgentConfig,
        suggestion: &RefinementSuggestion,
    ) -> SDKResult<AgentConfig> {
        // Use the first strategy that can handle this suggestion type
        if let Some(strategy) = self.strategies.first() {
            strategy.apply_suggestion(config, suggestion).await
        } else {
            // Fallback: basic application
            let mut updated = config.clone();
            updated.id = Uuid::new_v4().to_string();
            updated.version = config.version + 1;

            match suggestion.target {
                RefinementTarget::SystemPrompt => {
                    updated.system_prompt = suggestion.suggested_value.clone();
                }
                RefinementTarget::Instructions => {
                    updated.instructions_file = suggestion.suggested_value.clone();
                }
                _ => {
                    updated.instructions_file = format!(
                        "{}\n\n{}",
                        config.instructions_file, suggestion.suggested_value
                    );
                }
            }

            Ok(updated)
        }
    }

    fn min_confidence(&self) -> f64 {
        self.min_confidence
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/// Deduplicate suggestions that target the same area with similar changes
fn deduplicate_suggestions(suggestions: Vec<RefinementSuggestion>) -> Vec<RefinementSuggestion> {
    let mut seen_targets: std::collections::HashSet<(RefinementTarget, ChangeType)> =
        std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for suggestion in suggestions {
        let key = (suggestion.target.clone(), suggestion.change_type.clone());
        if !seen_targets.contains(&key) {
            seen_targets.insert(key);
            deduped.push(suggestion);
        }
    }

    deduped
}

/// Create a refinement strategy based on strategy name
pub fn create_refinement_strategy(name: &str) -> Box<dyn RefinementStrategy> {
    match name.to_lowercase().as_str() {
        "rule" | "rule-based" | "rules" => Box::new(RuleBasedStrategy::default()),
        "score" | "score-based" | "scoring" => Box::new(ScoreBasedStrategy::default()),
        "composite" | "combined" | "all" => Box::new(CompositeStrategy::default()),
        _ => Box::new(CompositeStrategy::default()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta_agent::types::{AgentProvider, ProjectContext, TaskSpec};
    use chrono::Utc;

    fn sample_config() -> AgentConfig {
        AgentConfig {
            id: "config-1".into(),
            name: "Test Config".into(),
            provider: AgentProvider::Claude,
            task_spec: sample_task(),
            project_context: sample_context(),
            system_prompt: "You are a helpful coding assistant.".into(),
            instructions_file: "# Instructions\n\nComplete the task.".into(),
            version: 1,
            created_at: Utc::now(),
        }
    }

    fn sample_task() -> TaskSpec {
        TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Add user authentication".into(),
            acceptance_criteria: vec!["Users can sign in".into(), "Sessions persist".into()],
            complexity: Some(5),
            relevant_files: vec!["src/auth.ts".into()],
            constraints: vec!["Must use OAuth".into()],
            beads_issue_id: None,
        }
    }

    fn sample_context() -> ProjectContext {
        ProjectContext {
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
        }
    }

    fn sample_benchmark_result(passed: bool, score: f64) -> BenchmarkResult {
        BenchmarkResult {
            benchmark_id: "bench-1".into(),
            config_id: "config-1".into(),
            score,
            passed,
            test_results: vec![
                TestCaseResult {
                    test_case_id: "test-1".into(),
                    passed,
                    score,
                    error: if passed {
                        None
                    } else {
                        Some("Missing pattern: authentication".into())
                    },
                    duration_ms: 100,
                },
            ],
            duration_ms: 100,
            errors: Vec::new(),
            warnings: Vec::new(),
            files_modified: Vec::new(),
            commands_executed: Vec::new(),
            executed_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_rule_based_strategy_passing() {
        let strategy = RuleBasedStrategy::default();
        let config = sample_config();
        let results = sample_benchmark_result(true, 0.9);

        let suggestions = strategy.analyze(&config, &results).await.unwrap();

        // No suggestions for passing tests
        assert!(suggestions.is_empty());
    }

    #[tokio::test]
    async fn test_rule_based_strategy_failing() {
        let strategy = RuleBasedStrategy::default();
        let config = sample_config();
        let results = sample_benchmark_result(false, 0.2);

        let suggestions = strategy.analyze(&config, &results).await.unwrap();

        // Should have suggestions for failing tests
        assert!(!suggestions.is_empty());
        assert!(suggestions.iter().any(|s| s.confidence >= 0.5));
    }

    #[tokio::test]
    async fn test_score_based_strategy() {
        let strategy = ScoreBasedStrategy::with_target(0.9);
        let config = sample_config();
        let results = sample_benchmark_result(false, 0.5);

        let suggestions = strategy.analyze(&config, &results).await.unwrap();

        // Should have suggestions due to score gap
        assert!(!suggestions.is_empty());
    }

    #[tokio::test]
    async fn test_composite_strategy() {
        let strategy = CompositeStrategy::default();
        let config = sample_config();
        let results = sample_benchmark_result(false, 0.3);

        let suggestions = strategy.analyze(&config, &results).await.unwrap();

        // Composite should combine suggestions from multiple strategies
        assert!(!suggestions.is_empty());
    }

    #[tokio::test]
    async fn test_apply_suggestion() {
        let strategy = RuleBasedStrategy::default();
        let config = sample_config();

        let suggestion = RefinementSuggestion {
            id: "sug-1".into(),
            target: RefinementTarget::SystemPrompt,
            change_type: ChangeType::Modify,
            current_value: Some(config.system_prompt.clone()),
            suggested_value: "New system prompt content".into(),
            rationale: "Test".into(),
            expected_impact: 0.3,
            confidence: 0.7,
        };

        let improved = strategy.apply_suggestion(&config, &suggestion).await.unwrap();

        assert_ne!(improved.id, config.id);
        assert_eq!(improved.version, config.version + 1);
        assert_eq!(improved.system_prompt, "New system prompt content");
    }

    #[tokio::test]
    async fn test_factory_function() {
        let rule_strategy = create_refinement_strategy("rule");
        assert_eq!(rule_strategy.min_confidence(), 0.5);

        let score_strategy = create_refinement_strategy("score");
        assert_eq!(score_strategy.min_confidence(), 0.5);

        let composite_strategy = create_refinement_strategy("composite");
        assert_eq!(composite_strategy.min_confidence(), 0.5);
    }

    #[tokio::test]
    async fn test_deduplicate_suggestions() {
        let suggestions = vec![
            RefinementSuggestion {
                id: "1".into(),
                target: RefinementTarget::SystemPrompt,
                change_type: ChangeType::Modify,
                current_value: None,
                suggested_value: "first".into(),
                rationale: "first".into(),
                expected_impact: 0.5,
                confidence: 0.7,
            },
            RefinementSuggestion {
                id: "2".into(),
                target: RefinementTarget::SystemPrompt,
                change_type: ChangeType::Modify,
                current_value: None,
                suggested_value: "second".into(),
                rationale: "second".into(),
                expected_impact: 0.3,
                confidence: 0.6,
            },
        ];

        let deduped = deduplicate_suggestions(suggestions);

        // Should only keep one SystemPrompt Modify suggestion
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].suggested_value, "first");
    }
}
