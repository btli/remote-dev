//! rdv-core - Core library for Remote Dev
//!
//! This crate provides shared functionality between the rdv CLI and rdv-server:
//!
//! - **db**: Direct SQLite database access
//! - **tmux**: tmux session management
//! - **worktree**: Git worktree operations
//! - **session**: Session lifecycle management
//! - **orchestrator**: Monitoring and intervention
//! - **auth**: Token-based authentication
//! - **mcp**: Model Context Protocol support

pub mod auth;
pub mod db;
pub mod error;
pub mod mcp;
pub mod orchestrator;
pub mod session;
pub mod tmux;
pub mod worktree;

// Re-export commonly used types
pub use db::Database;
pub use error::{Error, Result};
