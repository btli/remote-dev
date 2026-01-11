//! MCP (Model Context Protocol) server implementation.
//!
//! Provides MCP protocol support over stdio for AI assistant integration.
//! This runs alongside the REST API over Unix socket.

pub mod meta_agent_tools;
pub mod sdk_tools;
pub mod server;
pub mod tools;

pub use meta_agent_tools::register_meta_agent_tools;
pub use sdk_tools::register_sdk_tools;
pub use server::McpServer;
