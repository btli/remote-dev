//! Extension System
//!
//! Plugin architecture for custom tools, prompts, and memory providers.

mod types;
mod registry;
mod loader;

pub mod migrations;

// Re-export public types
pub use types::{
    Extension, ExtensionManifest, ExtensionState, ExtensionCapability,
    ToolDefinition, ToolInput, ToolOutput, ToolContext, ToolResult,
    PromptTemplate, PromptVariable, PromptContext,
    MemoryProviderDefinition, UIComponentDefinition, ResourceDefinition,
    ExtensionError, ExtensionResult,
};

pub use registry::ExtensionRegistry;
pub use loader::ExtensionLoader;
