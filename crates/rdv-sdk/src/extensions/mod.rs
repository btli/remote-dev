//! Extension System
//!
//! Plugin architecture for custom tools, prompts, memory providers, and lifecycle hooks.
//!
//! # Lifecycle Hooks
//!
//! Named callback hooks for extension lifecycle events, following the arXiv 2512.10398v5
//! agent UX patterns:
//!
//! ```rust
//! use rdv_sdk::extensions::hooks::{HookBuilder, HookPhase, HookResult, HookRegistry};
//! use std::sync::Arc;
//!
//! // Create a hook that logs input messages
//! let hook = HookBuilder::new("logger", HookPhase::OnInputMessages)
//!     .priority(50)
//!     .build(|ctx| async {
//!         println!("Processing {} messages", ctx.messages.len());
//!         HookResult::Continue
//!     });
//!
//! // Register with the hook registry
//! let registry = HookRegistry::new();
//! // registry.register(Arc::new(hook)).await;
//! ```
//!
//! Available hook phases:
//! - `OnInputMessages`: Before processing user input
//! - `OnPlainText`: For text content handling
//! - `OnTag`: For structured tag parsing
//! - `OnLlmOutput`: After LLM response
//! - `PreToolUse`/`PostToolUse`: Tool execution lifecycle
//! - `SessionStart`/`SessionEnd`: Session lifecycle
//! - `OnError`: Error handling
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
//! ```rust,ignore
//! use rdv_sdk::extensions::mcp_adapter::{DynamicToolRouter, MCPToolAdapter};
//! use rdv_sdk::extensions::builders::SDK;
//! use serde_json::json;
//!
//! // Create a tool
//! let tool = SDK::tool("search")
//!     .description("Search for files")
//!     .input_schema(json!({"type": "object"}))
//!     .build();
//!
//! // In an async context:
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
pub mod hooks;
pub mod composition;

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

// Re-export hook types
pub use hooks::{
    Hook, HookPhase, HookContext, HookResult, HookError,
    HookRegistry, HookBuilder, ClosureHook,
    Message, MessageRole, ParsedTag,
    SessionStorage, MemoryAccess, RunContext,
};

// Re-export composition types
pub use composition::{
    ExtensionTrait, ExtensionDependency, ExtensionComposer,
    ComposedExtensionStack, DependencyResolver, ManifestWithDependencies,
    CompositionError, CompositionResult,
};
