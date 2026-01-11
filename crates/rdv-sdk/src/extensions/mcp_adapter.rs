//! MCP Adapter for Extension Tools
//!
//! Bridges the extension system to MCP (Model Context Protocol) servers.
//! Enables dynamic tool registration/deregistration at runtime.
//!
//! # Architecture
//!
//! ```text
//! Extension Registry
//!       ↓
//! MCPToolAdapter (converts ToolDefinition → MCP format)
//!       ↓
//! DynamicToolRouter (manages runtime tools)
//!       ↓
//! MCP Server (serves tools to AI agents)
//! ```
//!
//! # Example
//!
//! ```rust
//! use rdv_sdk::extensions::{SDK, ExtensionRegistry};
//! use rdv_sdk::extensions::mcp_adapter::{MCPToolAdapter, DynamicToolRouter};
//!
//! // Register an extension with tools
//! let tool = SDK::tool("search")
//!     .description("Search files")
//!     .input_schema(json!({"type": "object", "properties": {"query": {"type": "string"}}}))
//!     .build();
//!
//! // The adapter converts extension tools to MCP format
//! let mcp_tool = MCPToolAdapter::to_mcp_tool(&tool);
//!
//! // The router can add/remove tools dynamically
//! let router = DynamicToolRouter::new();
//! router.register("my-extension", vec![tool]).await;
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{
    ExtensionError, ExtensionResult, ToolDefinition, ToolInput, ToolOutput, ToolContext,
};

/// MCP-compatible tool representation
///
/// This matches the structure expected by MCP servers (rmcp crate).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    /// Tool name (must be unique across all extensions)
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// JSON Schema for input parameters
    pub input_schema: Value,
    /// Optional annotations for tool behavior hints
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<MCPToolAnnotations>,
}

/// MCP tool annotations for behavior hints
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MCPToolAnnotations {
    /// Category for grouping in UI
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Whether tool is async/long-running
    #[serde(rename = "isAsync", skip_serializing_if = "Option::is_none")]
    pub is_async: Option<bool>,
    /// Whether tool has side effects
    #[serde(rename = "hasSideEffects", skip_serializing_if = "Option::is_none")]
    pub has_side_effects: Option<bool>,
    /// Required permissions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    /// Extension ID that provides this tool
    #[serde(rename = "extensionId", skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
}

/// MCP tool call result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPToolResult {
    /// Result content
    pub content: Vec<MCPContent>,
    /// Whether the tool call was successful
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// MCP content block
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MCPContent {
    /// Text content
    #[serde(rename = "text")]
    Text { text: String },
    /// JSON/structured content
    #[serde(rename = "resource")]
    Resource { uri: String, mime_type: String },
}

/// Adapter for converting extension tools to MCP format
pub struct MCPToolAdapter;

impl MCPToolAdapter {
    /// Convert a ToolDefinition to MCP tool format
    pub fn to_mcp_tool(tool: &ToolDefinition, extension_id: &str) -> MCPTool {
        MCPTool {
            name: format!("{}:{}", extension_id, tool.name),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
            annotations: Some(MCPToolAnnotations {
                category: tool.category.clone(),
                is_async: Some(tool.is_async),
                has_side_effects: Some(tool.has_side_effects),
                permissions: if tool.permissions.is_empty() {
                    None
                } else {
                    Some(tool.permissions.clone())
                },
                extension_id: Some(extension_id.to_string()),
            }),
        }
    }

    /// Convert multiple tools from an extension
    pub fn to_mcp_tools(tools: &[ToolDefinition], extension_id: &str) -> Vec<MCPTool> {
        tools
            .iter()
            .map(|t| Self::to_mcp_tool(t, extension_id))
            .collect()
    }

    /// Convert ToolOutput to MCP result format
    pub fn to_mcp_result(output: ToolOutput) -> MCPToolResult {
        if output.success {
            MCPToolResult {
                content: vec![MCPContent::Text {
                    text: output.data.to_string(),
                }],
                is_error: None,
            }
        } else {
            MCPToolResult {
                content: vec![MCPContent::Text {
                    text: output.error.unwrap_or_else(|| "Unknown error".to_string()),
                }],
                is_error: Some(true),
            }
        }
    }

    /// Parse MCP tool call arguments into ToolInput
    pub fn parse_mcp_input(
        args: Value,
        session_id: Option<String>,
        user_id: String,
        folder_id: Option<String>,
    ) -> ToolInput {
        ToolInput {
            args,
            context: ToolContext {
                session_id,
                user_id,
                folder_id,
                task_id: None,
                metadata: HashMap::new(),
            },
        }
    }
}

/// Tool handler callback type
pub type ToolHandler = Arc<
    dyn Fn(ToolInput) -> std::pin::Pin<Box<dyn std::future::Future<Output = ToolOutput> + Send>>
        + Send
        + Sync,
>;

/// Registered tool with handler
struct RegisteredTool {
    definition: ToolDefinition,
    extension_id: String,
    handler: Option<ToolHandler>,
}

/// Dynamic tool router for runtime tool management
///
/// Unlike static tool routers (like rmcp's #[tool_router]), this allows
/// tools to be added and removed at runtime as extensions are loaded/unloaded.
pub struct DynamicToolRouter {
    /// Registered tools by full name (extension:tool)
    tools: RwLock<HashMap<String, RegisteredTool>>,
    /// Change listeners for notification
    listeners: RwLock<Vec<Box<dyn Fn() + Send + Sync>>>,
}

impl Default for DynamicToolRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicToolRouter {
    /// Create a new dynamic tool router
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(HashMap::new()),
            listeners: RwLock::new(Vec::new()),
        }
    }

    /// Register tools from an extension
    ///
    /// Tools are namespaced with the extension ID: "extension_id:tool_name"
    pub async fn register_tools(
        &self,
        extension_id: &str,
        tools: Vec<ToolDefinition>,
    ) -> ExtensionResult<usize> {
        let mut registered = self.tools.write().await;
        let mut count = 0;

        for tool in tools {
            let full_name = format!("{}:{}", extension_id, tool.name);

            if registered.contains_key(&full_name) {
                return Err(ExtensionError::AlreadyRegistered(full_name));
            }

            registered.insert(
                full_name,
                RegisteredTool {
                    definition: tool,
                    extension_id: extension_id.to_string(),
                    handler: None,
                },
            );
            count += 1;
        }

        // Notify listeners
        drop(registered);
        self.notify_listeners().await;

        Ok(count)
    }

    /// Register a single tool with a handler
    pub async fn register_tool_with_handler(
        &self,
        extension_id: &str,
        tool: ToolDefinition,
        handler: ToolHandler,
    ) -> ExtensionResult<()> {
        let mut registered = self.tools.write().await;
        let full_name = format!("{}:{}", extension_id, tool.name);

        if registered.contains_key(&full_name) {
            return Err(ExtensionError::AlreadyRegistered(full_name));
        }

        registered.insert(
            full_name,
            RegisteredTool {
                definition: tool,
                extension_id: extension_id.to_string(),
                handler: Some(handler),
            },
        );

        drop(registered);
        self.notify_listeners().await;

        Ok(())
    }

    /// Set handler for an already registered tool
    pub async fn set_handler(
        &self,
        full_name: &str,
        handler: ToolHandler,
    ) -> ExtensionResult<()> {
        let mut registered = self.tools.write().await;

        let tool = registered.get_mut(full_name).ok_or_else(|| {
            ExtensionError::NotFound(full_name.to_string())
        })?;

        tool.handler = Some(handler);
        Ok(())
    }

    /// Unregister all tools from an extension
    pub async fn unregister_extension(&self, extension_id: &str) -> ExtensionResult<usize> {
        let mut registered = self.tools.write().await;
        let before_count = registered.len();

        registered.retain(|_, tool| tool.extension_id != extension_id);

        let removed = before_count - registered.len();

        drop(registered);
        if removed > 0 {
            self.notify_listeners().await;
        }

        Ok(removed)
    }

    /// Unregister a specific tool
    pub async fn unregister_tool(&self, full_name: &str) -> ExtensionResult<ToolDefinition> {
        let mut registered = self.tools.write().await;

        let tool = registered.remove(full_name).ok_or_else(|| {
            ExtensionError::NotFound(full_name.to_string())
        })?;

        drop(registered);
        self.notify_listeners().await;

        Ok(tool.definition)
    }

    /// List all registered tools in MCP format
    pub async fn list_mcp_tools(&self) -> Vec<MCPTool> {
        let registered = self.tools.read().await;

        registered
            .values()
            .map(|t| MCPToolAdapter::to_mcp_tool(&t.definition, &t.extension_id))
            .collect()
    }

    /// List tools as ToolDefinitions
    pub async fn list_tools(&self) -> Vec<(String, ToolDefinition)> {
        let registered = self.tools.read().await;

        registered
            .iter()
            .map(|(name, tool)| (name.clone(), tool.definition.clone()))
            .collect()
    }

    /// Get a tool definition by full name
    pub async fn get_tool(&self, full_name: &str) -> Option<ToolDefinition> {
        let registered = self.tools.read().await;
        registered.get(full_name).map(|t| t.definition.clone())
    }

    /// Check if a tool exists
    pub async fn has_tool(&self, full_name: &str) -> bool {
        let registered = self.tools.read().await;
        registered.contains_key(full_name)
    }

    /// Call a tool by name
    pub async fn call_tool(&self, full_name: &str, input: ToolInput) -> ExtensionResult<ToolOutput> {
        let registered = self.tools.read().await;

        let tool = registered.get(full_name).ok_or_else(|| {
            ExtensionError::NotFound(full_name.to_string())
        })?;

        let handler = tool.handler.clone().ok_or_else(|| {
            ExtensionError::ToolExecutionFailed(format!("No handler registered for {}", full_name))
        })?;

        // Release lock before calling handler
        drop(registered);

        let start = std::time::Instant::now();
        let result = handler(input).await;

        // Add duration if not already set
        let mut output = result;
        if output.duration_ms == 0 {
            output.duration_ms = start.elapsed().as_millis() as u64;
        }

        Ok(output)
    }

    /// Get tool count
    pub async fn tool_count(&self) -> usize {
        let registered = self.tools.read().await;
        registered.len()
    }

    /// Get tools by extension
    pub async fn tools_by_extension(&self, extension_id: &str) -> Vec<ToolDefinition> {
        let registered = self.tools.read().await;

        registered
            .values()
            .filter(|t| t.extension_id == extension_id)
            .map(|t| t.definition.clone())
            .collect()
    }

    /// Add a change listener
    pub async fn on_change(&self, callback: impl Fn() + Send + Sync + 'static) {
        let mut listeners = self.listeners.write().await;
        listeners.push(Box::new(callback));
    }

    async fn notify_listeners(&self) {
        let listeners = self.listeners.read().await;
        for listener in listeners.iter() {
            listener();
        }
    }
}

/// Bridge between ExtensionRegistry and DynamicToolRouter
///
/// Automatically syncs tools when extensions are registered/unregistered.
pub struct ExtensionMCPBridge {
    router: Arc<DynamicToolRouter>,
}

impl ExtensionMCPBridge {
    /// Create a new bridge
    pub fn new(router: Arc<DynamicToolRouter>) -> Self {
        Self { router }
    }

    /// Get the underlying router
    pub fn router(&self) -> Arc<DynamicToolRouter> {
        self.router.clone()
    }

    /// Sync an extension's tools to the router
    pub async fn sync_extension(
        &self,
        extension_id: &str,
        tools: Vec<ToolDefinition>,
    ) -> ExtensionResult<()> {
        // Remove existing tools first
        let _ = self.router.unregister_extension(extension_id).await;

        // Register new tools
        self.router.register_tools(extension_id, tools).await?;

        Ok(())
    }

    /// Remove an extension's tools from the router
    pub async fn remove_extension(&self, extension_id: &str) -> ExtensionResult<usize> {
        self.router.unregister_extension(extension_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_test_tool() -> ToolDefinition {
        ToolDefinition {
            name: "test_tool".to_string(),
            display_name: "Test Tool".to_string(),
            description: "A test tool".to_string(),
            category: Some("testing".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"]
            }),
            output_schema: None,
            is_async: false,
            has_side_effects: false,
            permissions: vec![],
            examples: vec![],
        }
    }

    #[test]
    fn test_mcp_tool_conversion() {
        let tool = create_test_tool();
        let mcp_tool = MCPToolAdapter::to_mcp_tool(&tool, "my-extension");

        assert_eq!(mcp_tool.name, "my-extension:test_tool");
        assert_eq!(mcp_tool.description, "A test tool");
        assert!(mcp_tool.annotations.is_some());

        let annotations = mcp_tool.annotations.unwrap();
        assert_eq!(annotations.category, Some("testing".to_string()));
        assert_eq!(annotations.is_async, Some(false));
        assert_eq!(annotations.extension_id, Some("my-extension".to_string()));
    }

    #[tokio::test]
    async fn test_dynamic_router_register() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        let count = router.register_tools("test-ext", vec![tool]).await.unwrap();
        assert_eq!(count, 1);
        assert_eq!(router.tool_count().await, 1);
        assert!(router.has_tool("test-ext:test_tool").await);
    }

    #[tokio::test]
    async fn test_dynamic_router_unregister() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        router.register_tools("test-ext", vec![tool]).await.unwrap();
        assert_eq!(router.tool_count().await, 1);

        let removed = router.unregister_extension("test-ext").await.unwrap();
        assert_eq!(removed, 1);
        assert_eq!(router.tool_count().await, 0);
    }

    #[tokio::test]
    async fn test_dynamic_router_list_mcp() {
        let router = DynamicToolRouter::new();
        let tool1 = create_test_tool();
        let mut tool2 = create_test_tool();
        tool2.name = "another_tool".to_string();

        router.register_tools("ext1", vec![tool1]).await.unwrap();
        router.register_tools("ext2", vec![tool2]).await.unwrap();

        let mcp_tools = router.list_mcp_tools().await;
        assert_eq!(mcp_tools.len(), 2);

        let names: Vec<_> = mcp_tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"ext1:test_tool"));
        assert!(names.contains(&"ext2:another_tool"));
    }

    #[tokio::test]
    async fn test_tool_with_handler() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        let handler: ToolHandler = Arc::new(|input| {
            Box::pin(async move {
                ToolOutput {
                    data: json!({"echo": input.args}),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                }
            })
        });

        router.register_tool_with_handler("test-ext", tool, handler).await.unwrap();

        let input = ToolInput {
            args: json!({"query": "hello"}),
            context: ToolContext {
                session_id: None,
                user_id: "user-1".to_string(),
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        };

        let output = router.call_tool("test-ext:test_tool", input).await.unwrap();
        assert!(output.success);
        assert_eq!(output.data["echo"]["query"], "hello");
    }

    #[tokio::test]
    async fn test_duplicate_registration_fails() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        router.register_tools("test-ext", vec![tool.clone()]).await.unwrap();

        let result = router.register_tools("test-ext", vec![tool]).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_mcp_result_conversion() {
        let success_output = ToolOutput {
            data: json!({"result": "ok"}),
            success: true,
            error: None,
            duration_ms: 100,
            side_effects: vec![],
        };

        let mcp_result = MCPToolAdapter::to_mcp_result(success_output);
        assert!(mcp_result.is_error.is_none());

        let error_output = ToolOutput {
            data: json!(null),
            success: false,
            error: Some("Something went wrong".to_string()),
            duration_ms: 50,
            side_effects: vec![],
        };

        let mcp_result = MCPToolAdapter::to_mcp_result(error_output);
        assert_eq!(mcp_result.is_error, Some(true));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hot-Reload Functionality Tests
    // ─────────────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_hot_reload_update_handler() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        // Register with initial handler
        let initial_handler: ToolHandler = Arc::new(|_| {
            Box::pin(async move {
                ToolOutput {
                    data: json!({"version": "v1"}),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                }
            })
        });

        router.register_tool_with_handler("hot-ext", tool, initial_handler).await.unwrap();

        // Call with initial handler
        let input = ToolInput {
            args: json!({}),
            context: ToolContext {
                session_id: None,
                user_id: "user-1".to_string(),
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        };

        let output = router.call_tool("hot-ext:test_tool", input.clone()).await.unwrap();
        assert_eq!(output.data["version"], "v1");

        // Update to new handler (hot-reload)
        let updated_handler: ToolHandler = Arc::new(|_| {
            Box::pin(async move {
                ToolOutput {
                    data: json!({"version": "v2"}),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                }
            })
        });

        router.set_handler("hot-ext:test_tool", updated_handler).await.unwrap();

        // Call with updated handler
        let output = router.call_tool("hot-ext:test_tool", input).await.unwrap();
        assert_eq!(output.data["version"], "v2");
    }

    #[tokio::test]
    async fn test_hot_reload_unregister_extension_tools() {
        let router = DynamicToolRouter::new();

        // Register multiple tools for one extension
        let mut tool1 = create_test_tool();
        tool1.name = "tool_a".to_string();
        let mut tool2 = create_test_tool();
        tool2.name = "tool_b".to_string();

        router.register_tools("hot-ext", vec![tool1, tool2]).await.unwrap();
        assert_eq!(router.tool_count().await, 2);

        // Unregister all tools for that extension (simulating hot-reload)
        let removed = router.unregister_extension("hot-ext").await.unwrap();
        assert_eq!(removed, 2);
        assert_eq!(router.tool_count().await, 0);
    }

    #[tokio::test]
    async fn test_hot_reload_tools_by_extension() {
        let router = DynamicToolRouter::new();

        // Register tools for two extensions
        let mut tool1 = create_test_tool();
        tool1.name = "tool_1".to_string();
        let mut tool2 = create_test_tool();
        tool2.name = "tool_2".to_string();

        router.register_tools("ext-a", vec![tool1]).await.unwrap();
        router.register_tools("ext-b", vec![tool2]).await.unwrap();

        // Get tools by extension
        let ext_a_tools = router.tools_by_extension("ext-a").await;
        assert_eq!(ext_a_tools.len(), 1);
        assert_eq!(ext_a_tools[0].name, "tool_1");

        let ext_b_tools = router.tools_by_extension("ext-b").await;
        assert_eq!(ext_b_tools.len(), 1);
        assert_eq!(ext_b_tools[0].name, "tool_2");
    }

    #[tokio::test]
    async fn test_hot_reload_unregister_single_tool() {
        let router = DynamicToolRouter::new();

        let mut tool1 = create_test_tool();
        tool1.name = "keep_me".to_string();
        let mut tool2 = create_test_tool();
        tool2.name = "remove_me".to_string();

        router.register_tools("ext", vec![tool1, tool2]).await.unwrap();
        assert_eq!(router.tool_count().await, 2);

        // Unregister single tool
        let removed = router.unregister_tool("ext:remove_me").await.unwrap();
        assert_eq!(removed.name, "remove_me");
        assert_eq!(router.tool_count().await, 1);
        assert!(router.has_tool("ext:keep_me").await);
        assert!(!router.has_tool("ext:remove_me").await);
    }

    #[tokio::test]
    async fn test_call_tool_without_handler() {
        let router = DynamicToolRouter::new();
        let tool = create_test_tool();

        // Register tool WITHOUT handler
        router.register_tools("ext", vec![tool]).await.unwrap();

        let input = ToolInput {
            args: json!({}),
            context: ToolContext {
                session_id: None,
                user_id: "user-1".to_string(),
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        };

        // Calling should fail gracefully
        let result = router.call_tool("ext:test_tool", input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_call_nonexistent_tool() {
        let router = DynamicToolRouter::new();

        let input = ToolInput {
            args: json!({}),
            context: ToolContext {
                session_id: None,
                user_id: "user-1".to_string(),
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        };

        let result = router.call_tool("nonexistent:tool", input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_handler_nonexistent_fails() {
        let router = DynamicToolRouter::new();

        let handler: ToolHandler = Arc::new(|_| {
            Box::pin(async move {
                ToolOutput {
                    data: json!({}),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                }
            })
        });

        let result = router.set_handler("nonexistent:tool", handler).await;
        assert!(result.is_err());
    }
}
