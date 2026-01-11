//! rdv-core - Core library for Remote Dev
//!
//! This crate provides shared functionality between the rdv CLI and rdv-server:
//!
//! - **types**: Shared data types (always available)
//! - **client**: API client for rdv-server (Unix socket, for CLI)
//! - **db**: Direct SQLite database access (server-side only)
//! - **tmux**: tmux session management
//! - **worktree**: Git worktree operations
//! - **session**: Session lifecycle management
//! - **orchestrator**: Monitoring and intervention
//! - **auth**: Token-based authentication
//! - **mcp**: Model Context Protocol support
//! - **learning**: Learning extraction and knowledge management
//! - **project**: Project detection and metadata
//! - **memory**: Hierarchical working memory system

pub mod auth;
#[cfg(feature = "client")]
pub mod client;
#[cfg(feature = "db")]
pub mod db;
pub mod error;
pub mod learning;
#[cfg(feature = "db")]
pub mod memory;
pub mod mcp;
pub mod orchestrator;
pub mod project;
pub mod session;
pub mod tmux;
pub mod types;
pub mod worktree;

// Re-export commonly used types
pub use types::*;
pub use error::{Error, Result};

#[cfg(feature = "db")]
pub use db::Database;

#[cfg(feature = "client")]
pub use client::ApiClient;

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript Type Export
// ─────────────────────────────────────────────────────────────────────────────

/// Generate TypeScript type definitions.
///
/// Run with: `cargo test --features ts-types export_bindings -- --nocapture`
///
/// Types are exported to: `../../src/types/generated/`
#[cfg(all(test, feature = "ts-types"))]
mod ts_export {
    use super::types::*;
    use ts_rs::TS;

    #[test]
    fn export_bindings() {
        let output_path = std::path::Path::new("../../src/types/generated");
        std::fs::create_dir_all(output_path).expect("Failed to create output directory");

        // Entity types
        User::export_all_to(output_path).expect("Failed to export User");
        Session::export_all_to(output_path).expect("Failed to export Session");
        Folder::export_all_to(output_path).expect("Failed to export Folder");
        Orchestrator::export_all_to(output_path).expect("Failed to export Orchestrator");
        StalledSession::export_all_to(output_path).expect("Failed to export StalledSession");

        // Input types
        NewSession::export_all_to(output_path).expect("Failed to export NewSession");
        NewFolder::export_all_to(output_path).expect("Failed to export NewFolder");
        NewOrchestrator::export_all_to(output_path).expect("Failed to export NewOrchestrator");
        Insight::export_all_to(output_path).expect("Failed to export Insight");
        NewInsight::export_all_to(output_path).expect("Failed to export NewInsight");
        OrchestratorSimple::export_all_to(output_path).expect("Failed to export OrchestratorSimple");
        InsightCounts::export_all_to(output_path).expect("Failed to export InsightCounts");
        AuditLog::export_all_to(output_path).expect("Failed to export AuditLog");
        GitHubRepository::export_all_to(output_path).expect("Failed to export GitHubRepository");

        // Project knowledge types
        ProjectKnowledgeMetadata::export_all_to(output_path).expect("Failed to export ProjectKnowledgeMetadata");
        Convention::export_all_to(output_path).expect("Failed to export Convention");
        LearnedPattern::export_all_to(output_path).expect("Failed to export LearnedPattern");
        SkillDefinition::export_all_to(output_path).expect("Failed to export SkillDefinition");
        SkillStep::export_all_to(output_path).expect("Failed to export SkillStep");
        ToolDefinition::export_all_to(output_path).expect("Failed to export ToolDefinition");
        ToolImplementation::export_all_to(output_path).expect("Failed to export ToolImplementation");
        AgentPerformance::export_all_to(output_path).expect("Failed to export AgentPerformance");
        TaskMetrics::export_all_to(output_path).expect("Failed to export TaskMetrics");
        ProjectKnowledge::export_all_to(output_path).expect("Failed to export ProjectKnowledge");
        NewProjectKnowledge::export_all_to(output_path).expect("Failed to export NewProjectKnowledge");

        // CLI token types
        CLIToken::export_all_to(output_path).expect("Failed to export CLIToken");
        NewCLIToken::export_all_to(output_path).expect("Failed to export NewCLIToken");
        CLITokenCreateResponse::export_all_to(output_path).expect("Failed to export CLITokenCreateResponse");
        CLITokenValidation::export_all_to(output_path).expect("Failed to export CLITokenValidation");

        // Memory types
        MemoryTier::export_all_to(output_path).expect("Failed to export MemoryTier");
        MemoryEntry::export_all_to(output_path).expect("Failed to export MemoryEntry");
        NewMemoryEntry::export_all_to(output_path).expect("Failed to export NewMemoryEntry");
        MemoryQueryFilter::export_all_to(output_path).expect("Failed to export MemoryQueryFilter");

        // Note types
        Note::export_all_to(output_path).expect("Failed to export Note");
        NewNote::export_all_to(output_path).expect("Failed to export NewNote");

        // Extension types
        ExtensionState::export_all_to(output_path).expect("Failed to export ExtensionState");
        Extension::export_all_to(output_path).expect("Failed to export Extension");
        NewExtension::export_all_to(output_path).expect("Failed to export NewExtension");
        ExtensionTool::export_all_to(output_path).expect("Failed to export ExtensionTool");
        NewExtensionTool::export_all_to(output_path).expect("Failed to export NewExtensionTool");
        ExtensionPrompt::export_all_to(output_path).expect("Failed to export ExtensionPrompt");
        NewExtensionPrompt::export_all_to(output_path).expect("Failed to export NewExtensionPrompt");

        // Meta-agent types
        MetaAgentConfig::export_all_to(output_path).expect("Failed to export MetaAgentConfig");
        NewMetaAgentConfig::export_all_to(output_path).expect("Failed to export NewMetaAgentConfig");
        MetaAgentBenchmark::export_all_to(output_path).expect("Failed to export MetaAgentBenchmark");
        NewMetaAgentBenchmark::export_all_to(output_path).expect("Failed to export NewMetaAgentBenchmark");
        MetaAgentBenchmarkResult::export_all_to(output_path).expect("Failed to export MetaAgentBenchmarkResult");
        NewMetaAgentBenchmarkResult::export_all_to(output_path).expect("Failed to export NewMetaAgentBenchmarkResult");

        println!("✅ TypeScript types exported to: {}", output_path.display());
    }
}
