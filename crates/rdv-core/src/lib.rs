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
