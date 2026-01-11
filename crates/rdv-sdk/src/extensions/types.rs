//! Extension Type Definitions

use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Extension error types
#[derive(Debug, Error)]
pub enum ExtensionError {
    #[error("Extension not found: {0}")]
    NotFound(String),

    #[error("Extension already registered: {0}")]
    AlreadyRegistered(String),

    #[error("Invalid extension manifest: {0}")]
    InvalidManifest(String),

    #[error("Extension load failed: {0}")]
    LoadFailed(String),

    #[error("Tool execution failed: {0}")]
    ToolExecutionFailed(String),

    #[error("Capability not supported: {0}")]
    CapabilityNotSupported(String),

    #[error("Extension disabled: {0}")]
    Disabled(String),

    #[error("Version mismatch: expected {expected}, got {actual}")]
    VersionMismatch { expected: String, actual: String },

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type ExtensionResult<T> = Result<T, ExtensionError>;

/// Extension state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionState {
    /// Extension is loaded and ready
    Active,
    /// Extension is loaded but disabled
    Disabled,
    /// Extension failed to load
    Failed,
    /// Extension is being loaded
    Loading,
    /// Extension is not loaded
    Unloaded,
}

/// Extension capabilities
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionCapability {
    /// Provides tools
    Tools,
    /// Provides prompt templates
    Prompts,
    /// Provides memory providers
    MemoryProviders,
    /// Provides UI components
    UIComponents,
    /// Provides resources
    Resources,
    /// Provides hooks
    Hooks,
}

/// Extension manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    /// Unique extension ID
    pub id: String,
    /// Display name
    pub name: String,
    /// Version string (semver)
    pub version: String,
    /// Description
    pub description: String,
    /// Author
    pub author: Option<String>,
    /// Homepage URL
    pub homepage: Option<String>,
    /// License
    pub license: Option<String>,
    /// Required SDK version
    pub sdk_version: String,
    /// Extension capabilities
    pub capabilities: Vec<ExtensionCapability>,
    /// Required permissions
    pub permissions: Vec<String>,
    /// Configuration schema (JSON Schema)
    pub config_schema: Option<serde_json::Value>,
    /// Default configuration
    pub default_config: Option<serde_json::Value>,
}

/// Extension instance
#[derive(Debug, Clone)]
pub struct Extension {
    /// Extension manifest
    pub manifest: ExtensionManifest,
    /// Current state
    pub state: ExtensionState,
    /// Configuration
    pub config: serde_json::Value,
    /// Tools provided
    pub tools: Vec<ToolDefinition>,
    /// Prompts provided
    pub prompts: Vec<PromptTemplate>,
    /// Memory providers
    pub memory_providers: Vec<MemoryProviderDefinition>,
    /// UI components
    pub ui_components: Vec<UIComponentDefinition>,
    /// Resources
    pub resources: Vec<ResourceDefinition>,
    /// Load timestamp
    pub loaded_at: Option<DateTime<Utc>>,
    /// Error message if failed
    pub error: Option<String>,
}

impl Extension {
    /// Create a new extension from manifest
    pub fn new(manifest: ExtensionManifest) -> Self {
        let config = manifest.default_config.clone().unwrap_or(serde_json::json!({}));

        Self {
            manifest,
            state: ExtensionState::Unloaded,
            config,
            tools: Vec::new(),
            prompts: Vec::new(),
            memory_providers: Vec::new(),
            ui_components: Vec::new(),
            resources: Vec::new(),
            loaded_at: None,
            error: None,
        }
    }

    /// Check if extension has a capability
    pub fn has_capability(&self, capability: ExtensionCapability) -> bool {
        self.manifest.capabilities.contains(&capability)
    }

    /// Check if extension is active
    pub fn is_active(&self) -> bool {
        self.state == ExtensionState::Active
    }
}

/// Tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Tool name (unique within extension)
    pub name: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// Category for grouping
    pub category: Option<String>,
    /// Input schema (JSON Schema)
    pub input_schema: serde_json::Value,
    /// Output schema (JSON Schema)
    pub output_schema: Option<serde_json::Value>,
    /// Whether tool is async
    pub is_async: bool,
    /// Whether tool has side effects
    pub has_side_effects: bool,
    /// Required permissions
    pub permissions: Vec<String>,
    /// Example inputs
    pub examples: Vec<ToolExample>,
}

/// Tool example
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExample {
    pub description: String,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
}

/// Tool input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInput {
    /// Input arguments
    pub args: serde_json::Value,
    /// Execution context
    pub context: ToolContext,
}

/// Tool execution context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolContext {
    /// Session ID
    pub session_id: Option<String>,
    /// User ID
    pub user_id: String,
    /// Folder ID
    pub folder_id: Option<String>,
    /// Task ID
    pub task_id: Option<String>,
    /// Additional metadata
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Tool output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    /// Output data
    pub data: serde_json::Value,
    /// Whether execution was successful
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// Side effects performed
    pub side_effects: Vec<String>,
}

/// Tool execution result
pub type ToolResult = Result<ToolOutput, ExtensionError>;

/// Prompt template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplate {
    /// Template name (unique within extension)
    pub name: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// Category for grouping
    pub category: Option<String>,
    /// Template content
    pub template: String,
    /// Template variables
    pub variables: Vec<PromptVariable>,
    /// Tags for search
    pub tags: Vec<String>,
    /// Example outputs
    pub examples: Vec<String>,
}

/// Prompt variable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptVariable {
    /// Variable name
    pub name: String,
    /// Description
    pub description: String,
    /// Type (string, number, boolean, array, object)
    pub var_type: String,
    /// Whether required
    pub required: bool,
    /// Default value
    pub default: Option<serde_json::Value>,
    /// Validation pattern (regex)
    pub pattern: Option<String>,
}

/// Prompt rendering context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptContext {
    /// Variable values
    pub variables: HashMap<String, serde_json::Value>,
    /// Session context
    pub session_id: Option<String>,
    /// User context
    pub user_id: Option<String>,
    /// Additional context
    pub extra: HashMap<String, serde_json::Value>,
}

/// Memory provider definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryProviderDefinition {
    /// Provider name
    pub name: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// Provider type (vector, graph, hybrid)
    pub provider_type: String,
    /// Configuration schema
    pub config_schema: Option<serde_json::Value>,
    /// Supported operations
    pub operations: Vec<String>,
}

/// UI component definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIComponentDefinition {
    /// Component name
    pub name: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// Component type (panel, modal, button, etc.)
    pub component_type: String,
    /// Target location (sidebar, toolbar, status-bar, etc.)
    pub location: String,
    /// Props schema
    pub props_schema: Option<serde_json::Value>,
    /// Priority for ordering
    pub priority: i32,
}

/// Resource definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceDefinition {
    /// Resource URI pattern
    pub uri_pattern: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// MIME type
    pub mime_type: String,
    /// Whether resource is cacheable
    pub cacheable: bool,
    /// Cache TTL in seconds
    pub cache_ttl: Option<u64>,
}

/// Extension database record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionRecord {
    pub id: String,
    pub manifest: serde_json::Value,
    pub config: serde_json::Value,
    pub state: String,
    pub enabled: bool,
    pub installed_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub error: Option<String>,
}
