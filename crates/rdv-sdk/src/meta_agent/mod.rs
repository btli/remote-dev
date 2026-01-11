//! Meta-Agent System
//!
//! Implements the BUILD → TEST → IMPROVE loop for configuration optimization.

mod types;
mod agent;

pub mod migrations;

// Re-export public types
pub use types::{
    TaskSpec, ProjectContext, AgentConfig,
    Benchmark, BenchmarkResult, TestCase, TestCaseResult,
    OptimizationResult, OptimizationOptions,
    RefinementSuggestion, ImprovementResult,
};

pub use agent::MetaAgent;
