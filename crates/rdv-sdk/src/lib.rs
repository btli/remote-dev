//! Remote Dev SDK - Central Library for All System Functionality
//!
//! This crate provides the unified SDK for Remote Dev. All functionality
//! is accessible through this single crate, including:
//!
//! # Core Modules (from rdv-core)
//!
//! - **tmux** - tmux session management (create, kill, capture, send keys)
//! - **session** - Terminal session lifecycle management
//! - **orchestrator** - Master Control and Folder Control monitoring
//! - **learning** - Learning extraction and knowledge management
//! - **project** - Project detection and metadata
//! - **worktree** - Git worktree operations
//! - **db** - Direct SQLite database access
//!
//! # SDK Modules
//!
//! - **memory** - Hierarchical working memory system (short-term, working, long-term)
//! - **meta-agent** - Build-test-improve loop for configuration optimization
//! - **extensions** - Modular plugin architecture for custom tools and prompts
//!
//! # TypeScript Type Generation
//!
//! Enable the `ts-types` feature to generate TypeScript type definitions:
//!
//! ```bash
//! cargo test --features ts-types export_bindings
//! ```
//!
//! # Example
//!
//! ```rust,no_run
//! use rdv_sdk::{SDK, SDKConfig};
//!
//! async fn example() -> anyhow::Result<()> {
//!     let sdk = SDK::new(SDKConfig {
//!         database_path: "sqlite.db".into(),
//!         user_id: "user-123".into(),
//!         ..Default::default()
//!     })?;
//!
//!     // Store short-term memory
//!     sdk.memory().remember("User ran `git status`", Default::default()).await?;
//!
//!     // Retrieve relevant context
//!     let context = sdk.memory().recall("git", Default::default()).await?;
//!
//!     Ok(())
//! }
//! ```

// ─────────────────────────────────────────────────────────────────────────────
// Re-export core modules from rdv-core
// ─────────────────────────────────────────────────────────────────────────────

/// tmux session management (create, kill, capture, send keys)
pub use rdv_core::tmux;

/// Terminal session lifecycle management
pub use rdv_core::session;

/// Master Control and Folder Control monitoring
pub use rdv_core::orchestrator;

/// Learning extraction and knowledge management
pub use rdv_core::learning;

/// Project detection and metadata
pub use rdv_core::project;

/// Git worktree operations
pub use rdv_core::worktree;

/// Database access
pub use rdv_core::db;

/// Core types (Session, Folder, NewSession, etc.)
pub use rdv_core::types;

/// Error types from core
pub use rdv_core::error as core_error;

/// Token-based authentication
pub use rdv_core::auth;

/// Model Context Protocol support
pub use rdv_core::mcp;

// ─────────────────────────────────────────────────────────────────────────────
// SDK-specific modules
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "memory")]
pub mod memory;

#[cfg(feature = "meta-agent")]
pub mod meta_agent;

#[cfg(feature = "extensions")]
pub mod extensions;

pub mod utils;

mod error;
mod config;
mod sdk;

// Re-export main SDK types
pub use config::SDKConfig;
pub use error::{SDKError, SDKResult};
pub use sdk::SDK;

// Re-export feature-gated modules
#[cfg(feature = "memory")]
pub use memory::{
    HierarchicalMemory, MemoryStore, MemoryEntry, MemoryTier,
    ShortTermEntry, WorkingEntry, LongTermEntry,
    MemoryQuery, MemoryResult, ConsolidationResult,
};

#[cfg(feature = "meta-agent")]
pub use meta_agent::{
    MetaAgent, TaskSpec, ProjectContext, AgentConfig,
    Benchmark, BenchmarkResult, OptimizationResult,
};

#[cfg(feature = "extensions")]
pub use extensions::{
    Extension, ExtensionRegistry, ToolDefinition,
    PromptTemplate, ExtensionManifest,
};
