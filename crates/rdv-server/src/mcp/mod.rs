//! MCP (Model Context Protocol) server implementation.
//!
//! Provides MCP protocol support over stdio for AI assistant integration.
//! This runs alongside the REST API over Unix socket.

pub mod sdk_tools;
pub mod server;
pub mod tools;

pub use sdk_tools::register_sdk_tools;
pub use server::McpServer;
