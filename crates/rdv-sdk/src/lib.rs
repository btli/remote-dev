//! Remote Dev SDK - Hierarchical Memory, Meta-Agent, and Extensions
//!
//! This crate provides the core SDK functionality for Remote Dev, implementing
//! the Confucius-inspired three-perspective architecture (AX/UX/DX).
//!
//! # Features
//!
//! - **memory** - Hierarchical working memory system (short-term, working, long-term)
//! - **meta-agent** - Build-test-improve loop for configuration optimization
//! - **extensions** - Modular plugin architecture for custom tools and prompts
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    Long-Term Memory                          │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
//! │  │ Project Knowledge│  │   Conventions   │  │   Patterns   │ │
//! │  │  (semantic)      │  │   (learned)     │  │  (extracted) │ │
//! │  └─────────────────┘  └─────────────────┘  └──────────────┘ │
//! └─────────────────────────────────────────────────────────────┘
//!                               ▲
//!                               │ consolidation
//!                               │
//! ┌─────────────────────────────────────────────────────────────┐
//! │                   Working Memory                             │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
//! │  │  Current Task   │  │  Active Files   │  │   Hypotheses │ │
//! │  │   Context       │  │   & Changes     │  │   & Plans    │ │
//! │  └─────────────────┘  └─────────────────┘  └──────────────┘ │
//! └─────────────────────────────────────────────────────────────┘
//!                               ▲
//!                               │ attention
//!                               │
//! ┌─────────────────────────────────────────────────────────────┐
//! │                   Short-Term Memory                          │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
//! │  │ Recent Commands │  │  Tool Results   │  │  Observations│ │
//! │  │   & Outputs     │  │  & Errors       │  │  & Notes     │ │
//! │  └─────────────────┘  └─────────────────┘  └──────────────┘ │
//! └─────────────────────────────────────────────────────────────┘
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

// Re-export main types
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
