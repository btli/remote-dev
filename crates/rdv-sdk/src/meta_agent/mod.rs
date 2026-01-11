//! Meta-Agent System
//!
//! Implements the BUILD → TEST → IMPROVE loop for configuration optimization.
//!
//! # Architecture
//!
//! The meta-agent system consists of:
//!
//! - **Traits**: Abstract interfaces for meta-agent operations
//!   - [`MetaAgentTrait`] - Core BUILD/TEST/IMPROVE loop
//!   - [`ProviderConfigGenerator`] - Provider-specific config generation
//!   - [`BenchmarkExecutor`] - Test case execution
//!   - [`RefinementStrategy`] - Configuration refinement
//!
//! - **Types**: Data structures for tasks, configs, benchmarks, and results
//!
//! - **Implementation**: [`MetaAgent`] struct implementing the traits
//!
//! # Example
//!
//! ```rust,ignore
//! use rdv_sdk::meta_agent::{MetaAgent, MetaAgentTrait, TaskSpec, TaskType, ProjectContext};
//!
//! let agent = MetaAgent::new(db, config);
//!
//! let task = TaskSpec {
//!     id: "task-1".into(),
//!     task_type: TaskType::Feature,
//!     description: "Add user authentication".into(),
//!     // ...
//! };
//!
//! let context = ProjectContext {
//!     project_path: "/path/to/project".into(),
//!     language: "typescript".into(),
//!     // ...
//! };
//!
//! // Run full optimization loop
//! let result = agent.optimize(&task, &context, None).await?;
//! ```

mod types;
mod traits;
mod agent;
mod generators;
mod benchmark;

pub mod migrations;

// Re-export public types
pub use types::{
    TaskSpec, TaskType, ProjectContext, AgentConfig, AgentProvider,
    Benchmark, BenchmarkResult, TestCase, TestCaseResult,
    OptimizationResult, OptimizationOptions, StopReason,
    RefinementSuggestion, RefinementTarget, ChangeType, ImprovementResult,
};

// Re-export traits
pub use traits::{
    MetaAgentTrait, ProviderConfigGenerator, BenchmarkExecutor, RefinementStrategy,
};

// Re-export implementation
pub use agent::MetaAgent;

// Re-export generators
pub use generators::{
    create_config_generator,
    ClaudeConfigGenerator, CodexConfigGenerator,
    GeminiConfigGenerator, OpenCodeConfigGenerator,
};

// Re-export benchmark framework
pub use benchmark::{
    MockBenchmarkExecutor, PatternBasedExecutor,
    BenchmarkBuilder, BenchmarkAnalyzer, BenchmarkSummary,
    run_benchmark,
};
