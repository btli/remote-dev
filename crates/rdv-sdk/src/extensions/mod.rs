//! Extension System
//!
//! Plugin architecture for custom tools, prompts, and memory providers.
//!
//! # Builders
//!
//! Use fluent builders to create extension components:
//!
//! ```rust
//! use rdv_sdk::extensions::builders::SDK;
//! use serde_json::json;
//!
//! let tool = SDK::tool("search")
//!     .description("Search for files")
//!     .input_schema(json!({"type": "object"}))
//!     .build();
//!
//! let prompt = SDK::prompt("review")
//!     .description("Code review")
//!     .template("Review: {{code}}")
//!     .build();
//! ```
//!
//! # MCP Integration
//!
//! Use the MCP adapter to expose extension tools to AI agents:
//!
//! ```rust
//! use rdv_sdk::extensions::mcp_adapter::{DynamicToolRouter, MCPToolAdapter};
//!
//! let router = DynamicToolRouter::new();
//! router.register_tools("my-ext", vec![tool]).await;
//!
//! // Get tools in MCP format for serving
//! let mcp_tools = router.list_mcp_tools().await;
//! ```

mod types;
mod registry;
mod loader;
pub mod builders;
pub mod mcp_adapter;

pub mod migrations;

// Re-export public types
pub use types::{
    Extension, ExtensionManifest, ExtensionState, ExtensionCapability,
    ToolDefinition, ToolInput, ToolOutput, ToolContext, ToolResult, ToolExample,
    PromptTemplate, PromptVariable, PromptContext,
    MemoryProviderDefinition, UIComponentDefinition, ResourceDefinition,
    ExtensionError, ExtensionResult,
};

pub use registry::ExtensionRegistry;
pub use loader::ExtensionLoader;

// Re-export builders for convenience
pub use builders::{SDK, ToolBuilder, PromptBuilder, ExtensionManifestBuilder, BuilderError};

// Re-export MCP adapter types
pub use mcp_adapter::{
    MCPTool, MCPToolAnnotations, MCPToolResult, MCPContent,
    MCPToolAdapter, DynamicToolRouter, ExtensionMCPBridge, ToolHandler,
};
